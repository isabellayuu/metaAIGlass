import {z} from 'zod';

/**
 * What Claude returns for one camera snapshot. Shared by the server (to
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

export const ScanSchema = z.object({
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
        label: z.string().describe('One word naming the step, e.g. Read, Length, Add, Solve.'),
        text: z
          .array(z.object({t: z.string(), color: ColorRole}))
          .describe(
            'The step as runs of text. Give each quantity the color of the model part it belongs to; plain words use "none".',
          ),
        hints: z
          .array(z.string())
          .describe('1-3 Socratic questions that guide without giving the answer.'),
        highlight: Highlight.describe('Which part of the 3D model to light up for this step.'),
      }),
    )
    .describe(
      '3-6 small steps. No step states the final answer; the last step asks the learner to do the last calculation.',
    ),
});

export type Scan = z.infer<typeof ScanSchema>;
export type ScanStep = Scan['steps'][number];
export type ScanHighlight = z.infer<typeof Highlight>;
