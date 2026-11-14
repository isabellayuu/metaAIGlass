import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {ApiError as GeminiApiError, GoogleGenAI} from '@google/genai';
import {z} from 'zod';
import {ScanSchema, type Scan} from './schema.ts';

/**
 * Recognition provider. Gemini is used when GEMINI_API_KEY is set; Claude is
 * kept as an alternative for when ANTHROPIC_API_KEY is set instead.
 */
const USE_GEMINI = () => Boolean(process.env.GEMINI_API_KEY) || !process.env.ANTHROPIC_API_KEY;
/** "Latest Flash" alias, so a model rename doesn't break the app. Override with GEMINI_MODEL. */
const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-flash-latest';

const SYSTEM = `You help learners with dyslexia and dyscalculia understand math word problems.

You receive one camera frame, or the problem typed or dictated as text. If it contains a math problem (printed or handwritten), read it, choose the 3D model that best shows its structure, and break the solution into small steps.

Writing rules for every step:
- One idea per step. Short sentences, plain words, at most about 20 words.
- Write numbers as digits.
- Color every quantity by the part of the model it describes: length (orange), width (blue), height (pink), total (green). Keep the same color for the same quantity in every step.
- For equal groups: the number of groups is width (blue), the items in each group are length (orange). For a number line: the first quantity is length, every later quantity is width, the result is total.
- Hints are Socratic questions. They point the learner at the model or at a smaller sub-step. They never state the answer.

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

async function recognizeWithGemini(input: RecognizeInput): Promise<Scan> {
  if (!process.env.GEMINI_API_KEY) {
    throw new RecognizeError('GEMINI_API_KEY is not set. Add it to .env.local.', 401);
  }
  gemini ??= new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL(),
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
  } catch (error) {
    if (error instanceof RecognizeError) throw error;
    if (error instanceof GeminiApiError) {
      if (error.status === 400 && /api key/i.test(error.message)) {
        throw new RecognizeError('GEMINI_API_KEY is invalid.', 401);
      }
      if (error.status === 401 || error.status === 403) {
        throw new RecognizeError('GEMINI_API_KEY is invalid or not allowed.', 401);
      }
      if (error.status === 404) {
        throw new RecognizeError(`Gemini model "${GEMINI_MODEL()}" not found. Set GEMINI_MODEL.`, 401);
      }
      if (error.status === 429) throw new RecognizeError('Rate limited. Try again shortly.', 429);
      throw new RecognizeError(`Gemini API error ${error.status}`, 502);
    }
    if (error instanceof SyntaxError) throw new RecognizeError('Gemini returned invalid JSON.', 502);
    throw error;
  }
}

export class RecognizeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Read a math problem from a camera frame or from text, and build the steps. */
export async function recognize(input: RecognizeInput): Promise<Scan> {
  return USE_GEMINI() ? recognizeWithGemini(input) : recognizeWithClaude(input);
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
