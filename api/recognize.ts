import type {IncomingMessage, ServerResponse} from 'node:http';
import {MAX_BODY_BYTES, RecognizeError, parseInput, recognize} from '../server/recognize.ts';

/** Vercel serverless function for POST /api/recognize (same contract as the Vite middleware). */
export default async function handler(req: IncomingMessage & {body?: unknown}, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, {error: 'POST only'});
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (raw.length > MAX_BODY_BYTES) return send(413, {error: 'Request too large'});
    send(200, await recognize(parseInput(JSON.parse(raw))));
  } catch (error) {
    if (error instanceof RecognizeError) return send(error.status, {error: error.message});
    console.error('[recognize]', error);
    send(500, {error: 'Recognition failed'});
  }
}
