import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = import.meta.dirname, base = process.env.BASE_URL;
const evidence = resolve(root, process.env.EVIDENCE_DIR || 'test-results');
if (!base) throw new Error('Set BASE_URL to the exact published release directory URL.');
const manifest = JSON.parse(await readFile(resolve(evidence, 'release-manifest.json'))), results = [];
const queue = [...manifest.files];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const file = queue.shift(), response = await fetch(new URL(file.path, base), { signal: AbortSignal.timeout(30000) });
    const data = Buffer.from(await response.arrayBuffer()), hash = createHash('sha256').update(data).digest('hex');
    const result = { path: file.path, status: response.status, mime: response.headers.get('content-type'), bytes: data.length, sha256: hash, passed: response.ok && hash === file.sha256 && data.length === file.bytes };
    if (file.path.endsWith('.wasm')) result.passed &&= result.mime?.startsWith('application/wasm');
    if (file.path.endsWith('.js')) result.passed &&= /javascript/.test(result.mime || '');
    results.push(result);
  }
}));
const report = { checkedAt: new Date().toISOString(), base, passed: results.every(file => file.passed), files: results.sort((a, b) => a.path.localeCompare(b.path)) };
await writeFile(resolve(evidence, 'public-verification.json'), JSON.stringify(report, null, 2));
console.log(`${results.filter(x => x.passed).length}/${results.length} public files passed content hashes and MIME checks`);
if (!report.passed) process.exitCode = 1;
