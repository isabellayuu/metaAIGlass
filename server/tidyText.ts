import type {Scan} from './schema.ts';

/**
 * Make every step read as a normal sentence, whatever model wrote it.
 *
 * Steps arrive as pieces ("runs") so each number can have its own color, for
 * example ["Find the cost of ", "3", " notebooks"]. The apps join the pieces
 * as they are. Some models (the lighter fallback models in particular) leave
 * out the spaces at the edges of the pieces, which gives "cost of3notebooks".
 * This file repairs that on the server, so the web app and the iOS app always
 * get clean text:
 *
 * - a space is added between two pieces when words or numbers would touch,
 *   but not before punctuation such as "." "," "?" or ")";
 * - runs of spaces are collapsed, and the sentence is trimmed at both ends;
 * - the caption gets the same clean-up.
 *
 * The math strip (`expression`) is drawn as separate chips, so it needs no
 * spaces and is only trimmed.
 *
 * Use cases: every recognition result, before hideAnswer() runs.
 */

type Run = {t: string; color: Scan['steps'][number]['text'][number]['color']};

/** Characters that never get a space in front of them. */
const NO_SPACE_BEFORE = /^[.,;:!?)\]%’'”]/;
/** Characters that never get a space after them. */
const NO_SPACE_AFTER = /[([“‘$€£]$/;

/** Returns `scan` with tidy spacing in every step's text, caption and strip. */
export function tidyScan(scan: Scan): Scan {
  return {
    ...scan,
    steps: scan.steps.map(step => ({
      ...step,
      text: tidyRuns(step.text),
      caption: tidySentence(step.caption ?? ''),
      expression: (step.expression ?? []).map(run => ({...run, t: run.t.trim()})).filter(run => run.t),
    })),
  };
}

/**
 * Fixes the spaces between runs so that joining them gives a normal
 * sentence. Each run keeps its color.
 */
export function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    let t = run.t.replace(/\s+/g, ' ');
    if (!t.trim()) {
      // A run that is only a space: keep one space between neighbours.
      if (out.length && !out[out.length - 1].t.endsWith(' ')) out[out.length - 1].t += ' ';
      continue;
    }
    const prev = out[out.length - 1];
    if (prev) {
      const prevEndsSpace = prev.t.endsWith(' ');
      const nextStartsSpace = t.startsWith(' ');
      if (prevEndsSpace && nextStartsSpace) {
        t = t.trimStart();
      } else if (!prevEndsSpace && !nextStartsSpace && needsSpace(prev.t, t)) {
        t = ' ' + t;
      }
      if (NO_SPACE_BEFORE.test(t.trimStart()) && prevEndsSpace) prev.t = prev.t.trimEnd();
    }
    out.push({...run, t});
  }
  if (out.length) {
    out[0].t = out[0].t.trimStart();
    out[out.length - 1].t = out[out.length - 1].t.trimEnd();
  }
  return out.filter(run => run.t);
}

/** True when the end of `a` and the start of `b` would run together. */
function needsSpace(a: string, b: string): boolean {
  if (NO_SPACE_BEFORE.test(b) || NO_SPACE_AFTER.test(a)) return false;
  return /[\p{L}\p{N}).%²³=+×÷−]$/u.test(a) && /^[\p{L}\p{N}(=+×÷−]/u.test(b);
}

/** Collapses spaces and fixes spacing before punctuation in plain text. */
export function tidySentence(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s+([.,;:!?)])/g, '$1').trim();
}
