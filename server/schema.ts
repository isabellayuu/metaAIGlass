import {z} from 'zod';

/**
 * What the model returns for one camera snapshot: a diagram plan per step
 * (drawn by the app), plus the older fields the web app still uses. Shared by the server (to
 * validate) and the client (as a type only, so zod stays out of the bundle).
 */

export const ColorRole = z.enum(['none', 'length', 'width', 'height', 'total']);

export const Highlight = z.enum([
  'none',
  'length',
  'width',
  'height',
  'perimeter',
  'area',
  'volume',
  'groups',
  'total',
]);

/** The five diagram types the app can draw (see the planner prompt in recognize.ts). */
export const DiagramType = z.enum(['bar_compare', 'bar_split', 'scale_pair', 'before_after', 'number_line']);

/** What an item in a diagram is. The unknown is always drawn as "?". */
export const ItemRole = z.enum(['known', 'unknown', 'result_hint', 'distractor']);

/**
 * One diagram, drawn by the app. Bars (or points) share one unit and one scale.
 * The unknown is {"label": "?", "value": null, "role": "unknown"}.
 */
export const DiagramSchema = z.object({
  type: DiagramType,
  unit: z.string().describe('The one unit every bar or point uses, e.g. "€", "cups", "%". Empty if none.'),
  total: z
    .number()
    .nullable()
    .describe('The whole, when bars are drawn as a share of it (e.g. 100 for percentages). Else null.'),
  items: z
    .array(
      z.object({
        label: z.string().describe('At most 3 words, e.g. "Old price", "3/4", "?".'),
        value: z.number().nullable().describe('The true numeric value; null for the unknown.'),
        role: ItemRole,
        derived: z
          .boolean()
          .describe('True for a value the app can check that is not in the problem (common denominator, unit conversion, scale factor).'),
        color: ColorRole.describe('Color of this item; the same quantity keeps its color in every step. The unknown uses "total".'),
      }),
    )
    .describe('bar_compare: 2-3 bars. bar_split: the one whole bar. scale_pair: 2 bars. before_after: 2 bars. number_line: 2-4 points.'),
  parts: z.number().describe('bar_split: number of equal parts (at most 12). Else 0.'),
  shaded: z.number().describe('bar_split: number of shaded parts. Else 0.'),
  factor: z.number().nullable().describe('scale_pair: the factor from the first bar to the second, if it is given or derived. Else null.'),
  start: z.number().describe('number_line: where the line starts. Else 0.'),
  end: z.number().describe('number_line: where the line ends. Else 0.'),
});

export const ScanSchema = z.object({
  supported: z
    .boolean()
    .describe('False when the problem is not about proportions, fractions, ratios, percentages, rates or comparing magnitudes, or the numbers are unclear.'),
  reason: z.string().describe('When supported is false: a short plain reason. Else empty.'),
  ignore: z.array(z.string()).describe('Details in the problem that do not matter and are not drawn.'),
  found: z
    .boolean()
    .describe('True only if a math word problem or arithmetic problem is clearly readable.'),
  problem_text: z.string().describe('The problem exactly as written, or empty if not found.'),
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .describe(
      'Where the problem text sits in the image, as fractions 0..1 of image width/height (x,y = top-left).',
    ),
  model: z.object({
    kind: z
      .enum(['rectangle', 'box', 'groups', 'number_line'])
      .describe(
        'rectangle: flat 2D shapes, perimeter or area. box: 3D solids, volume. groups: equal groups, multiplication or division. number_line: addition or subtraction of quantities.',
      ),
    length: z.number().describe('rectangle/box length, else 0'),
    width: z.number().describe('rectangle/box width, else 0'),
    height: z.number().describe('box height, else 0'),
    groups: z.number().describe('number of equal groups, else 0'),
    per_group: z.number().describe('items in each group, else 0'),
    values: z
      .array(z.number())
      .describe('number_line: each quantity in order; subtraction as a negative number. Else [].'),
    unit: z.string().describe('Unit word or symbol such as "m", "cm", "apples"; empty if none.'),
  }),
  answer: z
    .string()
    .describe('Final answer with unit. Used only to check the steps; the app never shows it.'),
  steps: z
    .array(
      z.object({
        label: z
          .string()
          .describe('The step\'s title from the step order: "What we know", "What is asked", "Make it comparable" or "Next move".'),
        text: z
          .array(z.object({t: z.string(), color: ColorRole}))
          .describe(
            'The step as runs of text. Give each quantity the color of the model part it belongs to; plain words use "none".',
          ),
        expression: z
          .array(z.object({t: z.string(), color: ColorRole}))
          .describe(
            'The step as a short visual math strip: numbers and symbols only, no words, at most 7 pieces, one operation per step. Each number keeps the color of its model part; operators (+ − × ÷ = → ∫ and similar) use "none"; a result from an earlier step is a number with color "none". Where the result of this step goes, write "?" in the total color. Example: [6 length] [× none] [4 width] [= none] [? total]. Empty only if the step has no calculation.',
          ),
        caption: z
          .string()
          .describe('Always fill. A caption of at most 8 plain words shown under the diagram on the glasses. In "Next move" it is the question for the student. Never the final answer.'),
        diagram: DiagramSchema.describe('The ONE diagram for this step.'),
        hints: z
          .array(z.string())
          .describe('1-3 Socratic questions that guide without giving the answer.'),
        highlight: Highlight.describe('Which part of the 3D model to light up for this step.'),
      }),
    )
    .describe(
      '2-4 simple steps, each ONE idea with ONE diagram, in the step order. No step states the final answer; the last step is a question for the student.',
    ),
});

export type Scan = z.infer<typeof ScanSchema>;
export type ScanStep = Scan['steps'][number];
export type ScanHighlight = z.infer<typeof Highlight>;
