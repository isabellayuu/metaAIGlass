import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {ScanSchema, type Scan} from './schema.ts';

const SYSTEM = `You help learners with dyslexia and dyscalculia understand math word problems.

You receive one camera frame. If it shows a math problem (printed or handwritten), read it, choose the 3D model that best shows its structure, and break the solution into small steps.

Writing rules for every step:
- One idea per step. Short sentences, plain words, at most about 20 words.
- Write numbers as digits.
- Color every quantity by the part of the model it describes: length (orange), width (blue), height (pink), total (green). Keep the same color for the same quantity in every step.
- For equal groups: the number of groups is width (blue), the items in each group are length (orange). For a number line: the first quantity is length, every later quantity is width, the result is total.
- Hints are Socratic questions. They point the learner at the model or at a smaller sub-step. They never state the answer.

If no math problem is readable, set found to false, leave steps empty, and fill the rest with zeros or empty strings.`;

let client: Anthropic | undefined;

export class RecognizeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Read a math problem from a JPEG frame (base64, no data: prefix). */
export async function recognize(jpegBase64: string): Promise<Scan> {
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
          content: [
            {type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: jpegBase64}},
            {type: 'text', text: 'Find the math problem in this frame and build the steps.'},
          ],
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
      throw new RecognizeError('ANTHROPIC_API_KEY is missing or invalid.', 500);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new RecognizeError('Rate limited. Try again shortly.', 429);
    }
    if (error instanceof Anthropic.APIError) {
      throw new RecognizeError(`Claude API error ${error.status}`, 502);
    }
    if (error instanceof Error && /api key|apiKey|authentication/i.test(error.message)) {
      throw new RecognizeError('ANTHROPIC_API_KEY is not set.', 500);
    }
    throw error;
  }
}

/** Largest accepted request body: a 1280px JPEG is well under this. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;
