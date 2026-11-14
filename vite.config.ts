import type {IncomingMessage, ServerResponse} from 'node:http';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv, type Connect, type Plugin} from 'vite';

/**
 * Serves POST /api/recognize from the Vite dev and preview servers, so the
 * API key stays on this machine and never reaches the browser bundle.
 * (api/recognize.ts serves the same route when deployed to Vercel.)
 */
function recognizeApi(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url !== '/api/recognize') return next();
    void handle(req, res);
  };
  return {
    name: 'recognize-api',
    configureServer: server => void server.middlewares.use(handler),
    configurePreviewServer: server => void server.middlewares.use(handler),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, {error: 'POST only'});

  const {recognize, RecognizeError, MAX_BODY_BYTES} = await import('./server/recognize.ts');
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) return send(413, {error: 'Image too large'});
      chunks.push(chunk as Buffer);
    }
    const {image} = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {image?: unknown};
    if (typeof image !== 'string' || image.length === 0) return send(400, {error: 'Missing image'});
    send(200, await recognize(image));
  } catch (error) {
    if (error instanceof RecognizeError) return send(error.status, {error: error.message});
    console.error('[recognize]', error);
    send(500, {error: 'Recognition failed'});
  }
}

export default defineConfig(({mode}) => {
  // Load GEMINI_* / ANTHROPIC_* keys from .env.local into the server process only.
  const env = loadEnv(mode, process.cwd(), ['GEMINI_', 'ANTHROPIC_']);
  for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
  return {plugins: [react(), recognizeApi()]};
});
