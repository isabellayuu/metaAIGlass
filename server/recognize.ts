import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {ApiError as GeminiApiError, GoogleGenAI} from '@google/genai';
import {z} from 'zod';
import {hideAnswer} from './hideAnswer.ts';
import {tidyScan} from './tidyText.ts';
import {ScanSchema, type Scan} from './schema.ts';

/**
 * Recognition provider. Gemini is used when GEMINI_API_KEY is set; Claude is
 * kept as an alternative for when ANTHROPIC_API_KEY is set instead.
 */
const USE_GEMINI = () => Boolean(process.env.GEMINI_API_KEY) || !process.env.ANTHROPIC_API_KEY;
/**
 * Gemini models to try, in order. The first is GEMINI_MODEL; the rest are
 * fallbacks (override with GEMINI_FALLBACK_MODELS, comma-separated) for when
 * a model is overloaded or rate limited, as the hackathon guide recommends.
 */
const GEMINI_MODELS = (): string[] => {
  const primary = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.6-flash,gemini-3.1-flash-lite')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
};
/** Wait before retrying the first model once when Gemini is busy. */
const RETRY_DELAY_MS = 1500;

/**
 * The diagram planner prompt (written by the team): NumLens plans simple
 * diagrams as JSON and the app draws them. The last part maps the plan onto
 * the extra fields the apps use (colors, math strip, phone sentence, and the
 * older 3D model the web app still draws).
 */
const SYSTEM = `You are the diagram planner for NumLens, a maths study aid for high school students who find reading and holding numbers in memory difficult. You do NOT draw. You output a JSON plan, and the app draws it.

GOAL
Turn the problem into 2 to 4 simple steps. Each step shows ONE idea with ONE diagram. Fewer words, more anchors.

NEVER
- State, hint at, or compute the final answer. The unknown is always shown as "?".
- Add decoration, icons, characters, or anything not needed to understand the quantities.
- Use more than 3 bars or 12 segments in a single diagram.
- Use words longer than 3 per label, or captions over 8 words.
- Invent numbers. Use only numbers from the problem, plus derived values that the app can check (common denominators, unit conversions, a scale factor). Mark derived values "derived": true.

CHOOSE ONE DIAGRAM TYPE PER STEP
1. "bar_compare": 2 or 3 bars on the SAME scale, to compare sizes (fractions, decimals, percentages, prices).
2. "bar_split": ONE whole bar divided into equal parts, with some parts shaded (fractions, ratios, parts of a whole).
3. "scale_pair": two aligned bars where the second is the first multiplied by a factor (proportion, rates, scale).
4. "before_after": two bars showing a value before and after a change (percent change, discounts).
5. "number_line": a line from a start to an end with 2 to 4 marked points (ordering, magnitude).

RULES FOR EVERY DIAGRAM
- All bars in one diagram share one unit and one scale. Give each bar its true numeric "value".
- Give the whole or total as "total" when it matters, so the bar can be drawn as a share of it.
- Use "role" to say what each item is: "known", "unknown", "result_hint" (never the answer), or "distractor".
- The unknown is {"label": "?", "value": null}.
- If the problem has details that do not matter, list them under "ignore" and do not draw them.

STEP ORDER
Step 1: "What we know" (the given numbers).
Step 2: "What is asked" (the unknown, shown as "?").
Step 3: "Make it comparable" (common units, matching denominators, same scale) if needed.
Step 4: "Next move" a question for the student to answer, not an answer.

IF YOU CANNOT DO THIS
If the problem is not about proportions, fractions, ratios, percentages, rates, or comparing magnitudes, or if the numbers are unclear, return:
{"supported": false, "reason": "short plain reason"}

OUTPUT
Return ONLY valid JSON matching the schema. No markdown, no commentary.

APP FIELDS (fill these too, they follow the plan above)
- supported: true when you made a plan; when false, set found to false, leave steps empty and fill the other fields with zeros or empty strings.
- Each step: label is its step-order title; caption is at most 8 plain words (in "Next move" it is the student's question); diagram is its ONE diagram.
- Colors: give each quantity one color and keep it in every step: the first known quantity "length" (orange), the second "width" (blue), a third "height" (pink); the unknown and totals use "total" (green); distractors use "none".
- text: the step as ONE short, normal sentence for the phone screen, split into pieces so each number has its color; put normal spaces inside the pieces.
- expression: the step as a short math strip, numbers and symbols only, at most 7 pieces, with "?" in the total color for the unknown. Empty when the step has no calculation.
- answer: the final answer, only to check your plan; the app never shows it.
- model and highlight are for an older view: pick the closest model kind (number_line for most of these problems) with simple values, highlight "none".
- hints: 1 short question.`;

/** A camera frame (JPEG, base64 without prefix) or the problem as plain text. */
export type RecognizeInput = {image: string} | {text: string};

/** Longest problem text accepted, in characters. */
export const MAX_TEXT_CHARS = 2000;

/** Validate an untrusted request body into a RecognizeInput. */
export function parseInput(body: unknown): RecognizeInput {
  const {image, text} = (body ?? {}) as {image?: unknown; text?: unknown};
  if (typeof image === 'string' && image.length > 0) return {image};
  if (typeof text === 'string' && text.trim().length > 0) {
    if (text.length > MAX_TEXT_CHARS) throw new RecognizeError('Problem text is too long.', 413);
    return {text: text.trim()};
  }
  throw new RecognizeError('Send an image or the problem text.', 400);
}

const TEXT_PROMPT = (text: string) =>
  `The wearer gave this math problem as text (no image). Set box to x=0, y=0, w=1, h=1.\n\nProblem:\n${text}`;
const IMAGE_PROMPT = 'Find the math problem in this frame and build the steps.';

let client: Anthropic | undefined;
let gemini: GoogleGenAI | undefined;

/** JSON Schema for Gemini, limited to the keywords it accepts. */
function geminiSchema(): unknown {
  const {$schema: _drop, ...schema} = z.toJSONSchema(ScanSchema) as Record<string, unknown>;
  void _drop;
  return schema;
}

/**
 * Reads the problem with Gemini. When a model answers "busy" (429 or 503),
 * retries the first model once after a short wait, then moves on to the next
 * model in GEMINI_MODELS. At most models + 1 calls, so a busy day does not
 * turn into many requests.
 */
async function recognizeWithGemini(input: RecognizeInput): Promise<Scan> {
  if (!process.env.GEMINI_API_KEY) {
    throw new RecognizeError('GEMINI_API_KEY is not set. Add it to .env.local.', 401);
  }
  gemini ??= new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  const models = GEMINI_MODELS();
  let lastBusy: GeminiApiError | undefined;
  for (const [index, model] of models.entries()) {
    for (let attempt = 1; attempt <= (index === 0 ? 2 : 1); attempt++) {
      try {
        const scan = await callGemini(model, input);
        console.info('[recognize] gemini ok', {model, attempt, steps: scan.steps.length});
        return scan;
      } catch (error) {
        if (!(error instanceof GeminiApiError)) throw toRecognizeError(error, model);
        const busy = error.status === 429 || error.status === 503;
        // A fallback model this key cannot use is skipped like a busy one.
        const missingFallback = error.status === 404 && index > 0;
        console.info('[recognize] gemini failed', {model, attempt, status: error.status});
        if (!busy && !missingFallback) throw toRecognizeError(error, model);
        if (busy) lastBusy = error;
        if (busy && index === 0 && attempt === 1) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        else break;
      }
    }
  }
  throw toRecognizeError(lastBusy ?? new Error('No Gemini model available'), models[0]);
}

/** One Gemini call with the system prompt and the JSON schema. */
async function callGemini(model: string, input: RecognizeInput): Promise<Scan> {
  console.info('[recognize] gemini call', {model, input: 'image' in input ? 'image' : 'text'});
  const response = await gemini!.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts:
          'image' in input
            ? [{inlineData: {mimeType: 'image/jpeg', data: input.image}}, {text: IMAGE_PROMPT}]
            : [{text: TEXT_PROMPT(input.text)}],
      },
    ],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: 'application/json',
      responseJsonSchema: geminiSchema(),
    },
  });
  const text = response.text;
  if (!text) throw new RecognizeError('Gemini returned no result.', 502);
  const parsed = ScanSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new RecognizeError('Gemini returned an unexpected result.', 502);
  return parsed.data;
}

/** Maps a Gemini failure to a message the app can show. */
function toRecognizeError(error: unknown, model: string): unknown {
  if (error instanceof RecognizeError) return error;
  if (error instanceof GeminiApiError) {
    if (error.status === 400 && /api key/i.test(error.message)) {
      return new RecognizeError('GEMINI_API_KEY is invalid.', 401);
    }
    if (error.status === 401 || error.status === 403) {
      return new RecognizeError('GEMINI_API_KEY is invalid or not allowed.', 401);
    }
    if (error.status === 404) {
      return new RecognizeError(`Gemini model "${model}" not found. Set GEMINI_MODEL.`, 401);
    }
    if (error.status === 429 || error.status === 503) {
      return new RecognizeError('Gemini is busy right now. Try again in a minute.', 429);
    }
    return new RecognizeError(`Gemini API error ${error.status}`, 502);
  }
  if (error instanceof SyntaxError) return new RecognizeError('Gemini returned invalid JSON.', 502);
  return error;
}

export class RecognizeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Read a math problem from a camera frame or from text, and build the steps. */
/**
 * Reads a math problem from a camera frame or text and returns the solution
 * steps, with normal spacing (tidyText.ts) and the final answer hidden
 * (hideAnswer.ts).
 */
export async function recognize(input: RecognizeInput): Promise<Scan> {
  const scan = USE_GEMINI() ? await recognizeWithGemini(input) : await recognizeWithClaude(input);
  // A problem the planner does not support has no steps to draw.
  const plan = scan.supported === false ? {...scan, found: false, steps: []} : scan;
  return hideAnswer(tidyScan(plan));
}

async function recognizeWithClaude(input: RecognizeInput): Promise<Scan> {
  try {
    // Created on first use so a missing key surfaces as a request error, not a crash.
    client ??= new Anthropic();
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {effort: 'medium', format: zodOutputFormat(ScanSchema)},
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            'image' in input
              ? [
                  {type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: input.image}},
                  {type: 'text', text: IMAGE_PROMPT},
                ]
              : [{type: 'text', text: TEXT_PROMPT(input.text)}],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new RecognizeError('The request was declined.', 422);
    }
    if (!response.parsed_output) {
      throw new RecognizeError('Could not read a result from the model.', 502);
    }
    return response.parsed_output;
  } catch (error) {
    if (error instanceof RecognizeError) throw error;
    if (error instanceof Anthropic.AuthenticationError) {
      throw new RecognizeError('ANTHROPIC_API_KEY is missing or invalid.', 401);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new RecognizeError('Rate limited. Try again shortly.', 429);
    }
    if (error instanceof Anthropic.APIError) {
      throw new RecognizeError(`Claude API error ${error.status}`, 502);
    }
    if (error instanceof Error && /api key|apiKey|authentication/i.test(error.message)) {
      throw new RecognizeError('ANTHROPIC_API_KEY is not set.', 401);
    }
    throw error;
  }
}

/** Largest accepted request body: a 1280px JPEG is well under this. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;
