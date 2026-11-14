/**
 * Shared color coding. Every quantity in the step text uses the same color as
 * the part of the 3D model it describes, so words and shapes match at a glance.
 * Bright, well-separated hues stay legible on an additive (black = clear) display.
 */
export type ColorKey = 'length' | 'width' | 'height' | 'total';

/** A run of step text. A tuple marks a color-coded quantity. */
export type TextRun = string | readonly [string, ColorKey];

export const PALETTE: Record<ColorKey, string> = {
  length: '#FFA94D',
  width: '#4DABF7',
  height: '#F783AC',
  total: '#69DB7C',
};
