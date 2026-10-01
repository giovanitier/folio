import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './server.mjs';
try { process.loadEnvFile(fileURLToPath(new URL('./.dev.vars', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Unable to load local configuration.'); }
const port = Number(process.env.PORT || 8787);
const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };
const env = { SEC_USER_AGENT: process.env.SEC_USER_AGENT, ASSETS: { async fetch(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!filename.startsWith(root + path.sep) && filename !== path.join(root, 'index.html')) return new Response('Not found', { status: 404 });
  try { return new Response(await readFile(filename), { headers: { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' } }); }
  catch { return new Response('Not found', { status: 404 }); }
} } };
http.createServer(async (req, res) => {
  try {
    const response = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method }), env, { waitUntil: promise => promise.catch(() => {}) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Request failed'); }
}).listen(port, '127.0.0.1', () => console.log(`Folio: http://127.0.0.1:${port}`));
