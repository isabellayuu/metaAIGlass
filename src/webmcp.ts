import {useEffect, useRef} from 'react';

/**
 * WebMCP tools: let Meta AI on the glasses drive Math Lens by voice.
 *
 * "Hey Meta, visualize this math problem" → Meta AI reads the problem and
 * calls mathlens_show_problem. Every tool performs the same state change as a
 * button, so the display always matches. The app works fully without these.
 */

type Execute = (args: Record<string, unknown>, options?: {signal?: AbortSignal}) => unknown;

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: {type: 'object'; properties: Record<string, {type: string; description: string}>; required?: string[]};
  annotations?: {readOnlyHint?: boolean};
  execute: Execute;
}

interface ModelContext {
  registerTool: (tool: ModelContextTool, options?: {signal?: AbortSignal}) => unknown;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

/** What the tools can read and do. Always reads the latest app state. */
export interface MathLensApi {
  state(): {
    status: 'idle' | 'working' | 'showing';
    problem?: string;
    step?: {number: number; total: number; label: string; text: string};
    hintsShown: string[];
    hintsLeft: number;
    lastError?: string;
  };
  showProblem(text: string): void;
  /** Move and return the step now on the display. */
  step(direction: 'next' | 'previous' | 'first'): {number: number; total: number; label: string; text: string} | undefined;
  hint(): string | null;
  clear(): void;
}

const NO_ANSWER =
  'Never say the final answer or solve the problem aloud: the learner works it out from the steps and hints.';

/** Assistant-facing instructions for one tool: its purpose and string parameters. */
interface ToolSpec {
  name: string;
  purpose: string;
  /** Parameter name → what to pass. All parameters are strings. */
  params?: Record<string, string>;
  required?: string[];
  readOnly?: boolean;
  execute: Execute;
}

function toTool(spec: ToolSpec): ModelContextTool {
  const properties: ModelContextTool['inputSchema']['properties'] = {};
  for (const [key, doc] of Object.entries(spec.params ?? {})) properties[key] = {type: 'string', description: doc};
  return {
    name: spec.name,
    description: spec.purpose,
    inputSchema: {type: 'object', properties, ...(spec.required ? {required: spec.required} : {})},
    ...(spec.readOnly ? {annotations: {readOnlyHint: true}} : {}),
    execute: spec.execute,
  };
}

/** A handled condition the assistant can explain and act on (not a protocol failure). */
function problem(message: string, next_action: string) {
  return JSON.stringify({error: true, message, next_action});
}

/** Register one tool; a failure is logged and never breaks the app or the other tools. */
function safeRegister(ctx: ModelContext, spec: ToolSpec, signal: AbortSignal) {
  try {
    const result = ctx.registerTool(toTool(spec), {signal});
    if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, err => console.error(`${spec.name} registration failed`, err));
    }
  } catch (err) {
    console.error(`${spec.name} registration failed`, err);
  }
}

const NOT_SHOWING = () =>
  problem('No problem is on the display yet.', 'Offer to visualize the problem the wearer is looking at.');

function mathLensTools(api: MathLensApi): ToolSpec[] {
  return [
    {
      name: 'mathlens_show_problem',
      purpose:
        'Show a math word problem as a color-coded 3D model with small solution steps on the display. ' +
        'Use when the wearer asks to visualize, explain or help with a math problem they are looking at: ' +
        'read the whole problem exactly as written and pass it here in one call. ' +
        NO_ANSWER,
      params: {problem_text: 'The full problem exactly as written, including every number and unit.'},
      required: ['problem_text'],
      execute: args => {
        const text = String(args.problem_text ?? '').trim();
        if (text.length < 3) {
          return problem(
            'No problem text was given.',
            'Ask the wearer to look at the problem again, read it, and call this tool with the full text.',
          );
        }
        // Building the steps can take longer than the tool deadline, so start
        // it and return; the display updates when it is ready.
        api.showProblem(text);
        return JSON.stringify({
          status: 'working',
          next_action:
            'Say in one short sentence that the steps are appearing on the display. ' + NO_ANSWER + ' Stop and talk.',
        });
      },
    },
    {
      name: 'mathlens_step',
      purpose: 'Move to the next or previous solution step on the display, or back to the first one.',
      params: {direction: 'One of: next, previous, first.'},
      required: ['direction'],
      execute: args => {
        if (api.state().status !== 'showing') return NOT_SHOWING();
        const raw = String(args.direction ?? 'next').toLowerCase();
        const step = api.step(
          raw.startsWith('prev') || raw === 'back' ? 'previous' : raw.startsWith('first') ? 'first' : 'next',
        );
        const last = step !== undefined && step.number === step.total;
        return JSON.stringify({
          step,
          next_action: last
            ? 'This is the final step. Say only that the last step is on the display so the wearer can check their own answer. Do not read it aloud. Stop and talk.'
            : 'Read the step text aloud briefly, then stop and talk. ' + NO_ANSWER,
        });
      },
    },
    {
      name: 'mathlens_hint',
      purpose: 'Show the next guiding hint question for the current step on the display.',
      execute: () => {
        if (api.state().status !== 'showing') return NOT_SHOWING();
        const hint = api.hint();
        if (!hint) {
          return problem('All hints for this step are already shown.', 'Suggest moving to the next step. Stop and talk.');
        }
        return JSON.stringify({
          hint,
          next_action: 'Read the hint question aloud word for word, then stop and let the wearer think. ' + NO_ANSWER,
        });
      },
    },
    {
      name: 'mathlens_get_state',
      purpose: 'Report what Math Lens is showing: the problem, the current step and hints already shown.',
      readOnly: true,
      execute: () => JSON.stringify({...api.state(), next_action: 'Answer the wearer briefly from this state. ' + NO_ANSWER}),
    },
    {
      name: 'mathlens_clear',
      purpose: 'Remove the current problem from the display.',
      execute: () => {
        api.clear();
        return JSON.stringify({status: 'idle', next_action: 'Confirm in a few words. Stop and talk.'});
      },
    },
  ];
}

/**
 * Register the tools while the app is open. `api` may change every render; the
 * tools always call the latest one. Without WebMCP this does nothing.
 */
export function useMathLensTools(api: MathLensApi) {
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const ctx = document.modelContext;
    if (!ctx?.registerTool) return;
    const ac = new AbortController();
    const proxy: MathLensApi = {
      state: () => apiRef.current.state(),
      showProblem: t => apiRef.current.showProblem(t),
      step: d => apiRef.current.step(d),
      hint: () => apiRef.current.hint(),
      clear: () => apiRef.current.clear(),
    };
    for (const spec of mathLensTools(proxy)) safeRegister(ctx, spec, ac.signal);
    return () => ac.abort();
  }, []);
}
