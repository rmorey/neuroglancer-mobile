import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(import.meta.dirname, process.env.SERVE_DIR || 'dist');
const fixtures = resolve(import.meta.dirname, 'tests/fixtures');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const requested = decodeURIComponent(url.pathname);
    const isFixture = requested.startsWith('/fixtures/');
    const base = isFixture ? fixtures : root;
    const relative = isFixture ? requested.slice('/fixtures/'.length) : requested.replace(/^\//, '') || 'index.html';
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range', 'Accept-Ranges': 'bytes' };
    if (req.method === 'OPTIONS') { res.writeHead(204, headers).end(); return; }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${data.length}` }).end(); return; }
      const body = data.subarray(start, end + 1);
      res.writeHead(206, { ...headers, 'Content-Length': body.length, 'Content-Range': `bytes ${start}-${end}/${data.length}` }); res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }).end('Not found'); }
}).listen(Number(process.env.PORT || 4174), '127.0.0.1', () => console.log(`Neuroglancer Mobile: http://127.0.0.1:${process.env.PORT || 4174}`));
