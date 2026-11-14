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

const SYSTEM = `You help learners with dyslexia and dyscalculia understand math word problems.

You receive one camera frame, or the problem typed or dictated as text. If it contains a math problem (printed or handwritten), read it, choose the 3D model that best shows its structure, and break the solution into small steps.

Keep everything simple and clear. The learners find reading and numbers hard:
- Choose the simplest picture that shows the problem. Keep the numbers as they are in the problem; do not invent extra quantities.
- 3 to 5 small steps. Fewer is better.

Writing rules for every step:
- One idea per step. One short, normal sentence in plain everyday words, at most about 15 words. No jargon.
- The text pieces are joined exactly as written, so put normal spaces inside the pieces (e.g. "The width is ", "4 m", "."), so the joined sentence reads naturally.
- Write numbers as digits.
- Color every quantity by the part of the model it describes: length (orange), width (blue), height (pink), total (green). Keep the same color for the same quantity in every step.
- For equal groups: the number of groups is width (blue), the items in each group are length (orange). For a number line: the first quantity is length, every later quantity is width, the result is total.
- Hints are Socratic questions. They point the learner at the model or at a smaller sub-step. They never state the answer.
- The learner mostly sees pictures, not words. Each step also has an expression: a short math strip of numbers and symbols only (no words), one operation, at most 7 pieces, colored like the text. A later step can use an earlier step's result as a plain number (color none). The final result is always "?" in the total color. Add a caption only when the picture and strip are not enough, and keep it to 4 words.
- Never give the final answer directly, not in any step and not in any hint. The learner works it out. The last step names the last calculation and asks the learner to do it, for example "Now work out 6 × 4. That is the area." Put the final answer only in the answer field; the app never shows it.

If no math problem is readable, set found to false, leave steps empty, and fill the rest with zeros or empty strings.`;

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
  return hideAnswer(tidyScan(scan));
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
