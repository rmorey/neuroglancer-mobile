import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
const root = import.meta.dirname, release = resolve(root, process.env.RELEASE_DIR || 'release');
const evidence = resolve(root, process.env.EVIDENCE_DIR || 'test-results');
// A release must be prepared from one build; refuse to mix old hashed assets into it.
await mkdir(release);
await cp(resolve(root, 'dist'), release, { recursive: true });
await cp(resolve(root, 'tests/fixtures'), resolve(release, 'fixtures'), { recursive: true });
async function files(path) { const entries = await readdir(path, { withFileTypes: true }); const result = []; for (const entry of entries) { const file = join(path, entry.name); if (entry.isDirectory()) result.push(...await files(file)); else if (entry.isFile()) result.push(file); } return result; }
const artifacts = [];
for (const path of (await files(release)).sort()) {
  const data = await readFile(path); artifacts.push({ path: relative(release, path), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const manifest = { createdAt: new Date().toISOString(), upstream: JSON.parse(await readFile(resolve(root, 'UPSTREAM.json'))), files: artifacts, totalBytes: artifacts.reduce((sum, file) => sum + file.bytes, 0) };
await mkdir(evidence, { recursive: true });
await writeFile(resolve(evidence, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(resolve(evidence, 'release-sha256.txt'), artifacts.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n');
console.log(`${artifacts.length} release files; ${manifest.totalBytes} bytes`);
