/**
 * Word problems broken into small, single-idea steps.
 *
 * Every number in the text carries the same color as the part of the diagram it
 * describes, so the learner can match words to shapes without re-reading.
 */

export type ColorKey = 'length' | 'width' | 'total';

/** A run of step text. A tuple marks a color-coded quantity. */
export type TextRun = string | readonly [string, ColorKey];

export type Diagram =
  | {
      kind: 'rect';
      cols: number;
      rows: number;
      unit: string;
      show: 'outline' | 'length' | 'width' | 'both' | 'total';
      totalLabel?: string;
    }
  | {
      kind: 'unroll';
      segments: readonly {value: number; color: ColorKey}[];
      unit: string;
      showTotals: boolean;
      showAnswer: boolean;
    }
  | {
      kind: 'grid';
      cols: number;
      rows: number;
      show: 'outline' | 'row' | 'rows' | 'skip' | 'total';
    };

export interface Step {
  /** One-word eyebrow naming the step's job. */
  label: string;
  text: readonly TextRun[];
  /** Socratic questions, revealed one at a time. They never give the answer. */
  hints: readonly string[];
  diagram: Diagram;
  /** Plain-language description of the diagram for assistive technology. */
  diagramLabel: string;
}

export interface Problem {
  /** Two words at most; shown in the Page header. */
  title: string;
  steps: readonly Step[];
}

const fence = [
  {value: 6, color: 'length'},
  {value: 4, color: 'width'},
  {value: 6, color: 'length'},
  {value: 4, color: 'width'},
] as const;

export const PROBLEMS: readonly Problem[] = [
  {
    title: 'Garden fence',
    steps: [
      {
        label: 'Read',
        text: [
          'Maya’s garden is ',
          ['6 m long', 'length'],
          ' and ',
          ['4 m wide', 'width'],
          '. She puts a fence all the way around. How much fence does she need?',
        ],
        hints: [
          'What shape is the garden?',
          'Does a fence go inside the garden, or around its edge?',
        ],
        diagram: {kind: 'rect', cols: 6, rows: 4, unit: 'm', show: 'outline'},
        diagramLabel: 'A rectangle showing the garden.',
      },
      {
        label: 'Length',
        text: ['The long sides are ', ['6 m', 'length'], ' each. There are two of them.'],
        hints: [
          'Which sides of the rectangle look longer?',
          'Is the bottom side the same as the top side?',
        ],
        diagram: {kind: 'rect', cols: 6, rows: 4, unit: 'm', show: 'length'},
        diagramLabel: 'The top and bottom sides are orange and labeled 6 m.',
      },
      {
        label: 'Width',
        text: ['The short sides are ', ['4 m', 'width'], ' each. There are two of them.'],
        hints: [
          'Which sides have not been colored yet?',
          'Do the left and right sides match each other?',
        ],
        diagram: {kind: 'rect', cols: 6, rows: 4, unit: 'm', show: 'both'},
        diagramLabel:
          'Top and bottom are orange, 6 m. Left and right are blue dashed lines, 4 m.',
      },
      {
        label: 'Unroll',
        text: ['Lay the fence flat. The four sides make one long line.'],
        hints: [
          'If you walk all the way around, how many sides do you pass?',
          'What comes after a long side: a long side or a short side?',
        ],
        diagram: {kind: 'unroll', segments: fence, unit: 'm', showTotals: false, showAnswer: false},
        diagramLabel: 'The four sides laid in a line: 6, 4, 6, 4.',
      },
      {
        label: 'Add',
        text: [
          ['6', 'length'],
          ' + ',
          ['4', 'width'],
          ' + ',
          ['6', 'length'],
          ' + ',
          ['4', 'width'],
          ' = ?',
        ],
        hints: [
          'Can you add the two orange pieces first?',
          'What do the two blue pieces make together?',
          'Look at the number under the end of the line. What is it?',
        ],
        diagram: {kind: 'unroll', segments: fence, unit: 'm', showTotals: true, showAnswer: false},
        diagramLabel: 'A number line under the pieces marks 0, 6, 10, 16, and 20.',
      },
      {
        label: 'Answer',
        text: ['12 + 8 = ', ['20 m', 'total'], '. Maya needs 20 m of fence.'],
        hints: ['Walk the edge again: 6, then 4, then 6, then 4. Do you end at 20?'],
        diagram: {kind: 'rect', cols: 6, rows: 4, unit: 'm', show: 'total', totalLabel: '20 m'},
        diagramLabel: 'The whole edge is green. The fence is 20 m.',
      },
    ],
  },
  {
    title: 'Floor tiles',
    steps: [
      {
        label: 'Read',
        text: [
          'Leo tiles a floor. It is ',
          ['5 tiles long', 'length'],
          ' and ',
          ['3 tiles wide', 'width'],
          '. How many tiles does he need?',
        ],
        hints: [
          'Does Leo need tiles for the edge, or for the whole floor?',
          'Could you count the squares one by one? Is there a faster way?',
        ],
        diagram: {kind: 'grid', cols: 5, rows: 3, show: 'outline'},
        diagramLabel: 'A grid of squares, 5 across and 3 down.',
      },
      {
        label: 'Row',
        text: ['Look at one row. It has ', ['5', 'length'], ' tiles.'],
        hints: ['Count the orange squares. How many are there?'],
        diagram: {kind: 'grid', cols: 5, rows: 3, show: 'row'},
        diagramLabel: 'The top row of 5 squares is orange.',
      },
      {
        label: 'Rows',
        text: ['There are ', ['3', 'width'], ' rows. Each row is the same.'],
        hints: [
          'Count the blue numbers on the left. How many rows?',
          'Does every row have 5 tiles?',
        ],
        diagram: {kind: 'grid', cols: 5, rows: 3, show: 'rows'},
        diagramLabel: 'Each row is numbered 1, 2, 3 in blue on the left.',
      },
      {
        label: 'Count',
        text: ['Count by fives, one row at a time: ', ['5, 10, 15', 'total'], '.'],
        hints: [
          'After the first row you have 5. What do you have after the second?',
          'What number do you say for the last row?',
        ],
        diagram: {kind: 'grid', cols: 5, rows: 3, show: 'skip'},
        diagramLabel: 'Running totals on the right of each row: 5, 10, 15.',
      },
      {
        label: 'Answer',
        text: [
          ['3', 'width'],
          ' rows × ',
          ['5', 'length'],
          ' tiles = ',
          ['15', 'total'],
          '. Leo needs 15 tiles.',
        ],
        hints: ['Does 3 groups of 5 match the number you counted?'],
        diagram: {kind: 'grid', cols: 5, rows: 3, show: 'total'},
        diagramLabel: 'All 15 squares are green.',
      },
    ],
  },
];

export interface FlatStep {
  problemIndex: number;
  stepIndex: number;
  problem: Problem;
  step: Step;
}

export const FLAT_STEPS: readonly FlatStep[] = PROBLEMS.flatMap((problem, problemIndex) =>
  problem.steps.map((step, stepIndex) => ({problemIndex, stepIndex, problem, step})),
);
