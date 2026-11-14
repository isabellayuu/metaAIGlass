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
 * - Any step text or hint that still contains the answer (for example
 *   "The area is 24 m²") gets the answer replaced with "?".
 * - Runs colored `total` stand for the result, so a bare number in one of
 *   them is replaced too ("24" → "?"), while words such as "the area" stay.
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

/** Replaces every standalone number in `text` with the placeholder. */
export function scrubNumbers(text: string): string {
  return text.replace(/(?<![\w.,])-?\d+(?:[.,]\d+)?(?![\w.,]*\d)/g, HIDDEN);
}

/** Escapes `text` for literal use inside a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
