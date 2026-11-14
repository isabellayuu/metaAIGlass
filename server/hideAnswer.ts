import type {Scan} from './schema.ts';

/**
 * Hide the final answer from everything the apps receive.
 *
 * Math Lens never gives the answer directly: the learner works it out from the
 * small steps and the hints. The model is asked for the answer anyway (it
 * keeps the steps consistent), and the prompt tells it never to write the
 * answer in a step or hint. This file is the safety net for when it does:
 *
 * - `answer` is always sent back empty, so no client can show it.
 * - Any step text, math strip (`expression`), caption or hint that still
 *   contains the answer (for example "The area is 24 m²") gets the answer
 *   replaced with "?".
 * - Runs colored `total` stand for the result, so a bare number in one of
 *   them is replaced too ("24" → "?"), while words such as "the area" stay.
 *
 * - In each step's diagram the unknown is "?" without a value, and no
 *   unknown, result hint or derived item may carry the answer's value.
 *
 * Use cases: camera scans and typed problems in the web app, and photos from
 * the glasses in the iOS app; all of them go through `recognize()`.
 */

/** Placeholder shown where the answer would have been. */
export const HIDDEN = '?';

/**
 * Returns a copy of `scan` with the answer removed from `answer`, every step
 * and every hint. Leaves scans with `found: false` unchanged apart from `answer`.
 */
export function hideAnswer(scan: Scan): Scan {
  const patterns = answerPatterns(scan.answer);
  const scrub = (text: string) => patterns.reduce((out, re) => out.replace(re, HIDDEN), text);
  const steps = scan.steps.map(step => ({
    ...step,
    text: step.text.map(run => ({
      ...run,
      t: run.color === 'total' ? scrubNumbers(scrub(run.t)) : scrub(run.t),
    })),
    // `?? []` / `?? ''`: tolerate a model reply that leaves the new fields out.
    expression: (step.expression ?? []).map(run => ({
      ...run,
      t: run.color === 'total' ? scrubNumbers(scrub(run.t)) : scrub(run.t),
    })),
    caption: scrub(step.caption ?? ''),
    diagram: step.diagram && hideInDiagram(step.diagram, scrub, answerValue(scan.answer)),
    hints: step.hints.map(scrub),
  }));
  return {...scan, answer: '', steps};
}

/**
 * Regular expressions matching the answer as it might be written in a step:
 * the full answer ("24 m²") and, when it has a unit, the number followed by
 * that unit with any spacing ("24m²", "24 m²"). A bare number on its own is
 * not matched here, because the same number can be a legitimate quantity in
 * an earlier step (for example a width of 4 when the answer is 4).
 */
export function answerPatterns(answer: string): RegExp[] {
  const full = answer.trim();
  // A bare number is left to scrubNumbers() in total-colored runs only.
  if (!full || /^-?\d+(?:[.,]\d+)?$/.test(full)) return [];
  const patterns = [new RegExp(escape(full), 'gi')];
  const match = full.match(/^(-?\d+(?:[.,]\d+)?)\s*(.+)$/);
  if (match) {
    const [, number, unit] = match;
    patterns.push(new RegExp(`(?<![\\d.,])${escape(number)}\\s*${escape(unit.trim())}`, 'gi'));
  }
  return patterns;
}

type Diagram = Scan['steps'][number]['diagram'];

/** The answer's number, e.g. 60 for "€60" or 0.75 for "0.75 kg"; null if none. */
export function answerValue(answer: string): number | null {
  const m = answer.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Diagram items: the unknown is always "?" with no value, and an item that
 * is not given in the problem (unknown, result hint or derived) never carries
 * the answer's value. Labels are scrubbed like the text.
 */
function hideInDiagram(diagram: Diagram, scrub: (t: string) => string, answer: number | null): Diagram {
  const same = (v: number | null) => v !== null && answer !== null && Math.abs(v - answer) < 1e-9;
  return {
    ...diagram,
    items: (diagram.items ?? []).map(item => {
      const hidden =
        item.role === 'unknown' || ((item.role === 'result_hint' || item.derived) && same(item.value));
      return hidden
        ? {...item, label: HIDDEN, value: null, role: 'unknown' as const, color: 'total' as const}
        : {...item, label: scrub(item.label)};
    }),
  };
}

/** Replaces every standalone number in `text` with the placeholder. */
export function scrubNumbers(text: string): string {
  return text.replace(/(?<![\w.,])-?\d+(?:[.,]\d+)?(?![\w.,]*\d)/g, HIDDEN);
}

/** Escapes `text` for literal use inside a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
