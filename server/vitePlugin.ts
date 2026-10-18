import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

export function apiDevPlugin(): Plugin {
  return {
    name: 'attendance-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api')) {
          next();
          return;
        }
        try {
          const { handleRequest } = await import('./handler');
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value == null) continue;
            if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
            else headers.set(key, value);
          }
          const host = req.headers.host || 'localhost';
          const response = await handleRequest(new Request(`http://${host}${url}`, { method: req.method, headers, body }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const payload = Buffer.from(await response.arrayBuffer());
          res.end(payload);
        } catch (error) {
          console.error(error);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'API failed to start.' }));
        }
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
