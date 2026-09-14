import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from './browser-runtime.mjs';
const base = (process.env.BASE_URL || process.env.NG_TEST_URL || 'http://127.0.0.1:4174').replace(/\/$/, '');
const documentURL = new URL(/\.html?$/i.test(base) ? base : `${base}/index.html`);
const tag = process.env.EVIDENCE_TAG ? `${process.env.EVIDENCE_TAG}-` : '';
assert.match(tag, /^[a-z0-9-]*$/);
const fixture = JSON.parse(await readFile(new URL('./fixtures/editable-annotation-state.json', import.meta.url)));
const evidenceDir = resolve(import.meta.dirname, '..', process.env.EVIDENCE_DIR || 'test-results');
await mkdir(evidenceDir, { recursive: true });
const checks = [], errors = [];
let buildVersion;
const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack, after: checks.at(-1)?.name || 'startup' }));
const api = expression => page.evaluate(expression);
const snapshot = () => api(() => window.neuroglancerMobile.annotations.snapshot());
const record = async name => { checks.push({ name, pass: true, snapshot: await snapshot() }); console.log(`PASS ${name}`); };
async function openAnnotations() {
  await api(() => window.neuroglancerMobile.openPanel('annotations'));
  await page.locator('.mobile-annotations').waitFor();
}
async function select(id) {
  await page.locator(`[data-annotation-id="${id}"]`).click();
  await page.locator('.mobile-annotation-editor h3').filter({ hasText: id }).waitFor();
  await page.getByLabel('Annotation description', { exact: true }).waitFor();
}
async function save() { await page.getByRole('button', { name: 'Save changes', exact: true }).click(); }
function coordinate(group, dimension) { return page.getByRole('group', { name: group, exact: true }).locator('input').nth(dimension); }
try {
  buildVersion = await (await page.request.get(new URL('version.json', documentURL).href)).json();
  await page.goto(`${documentURL.href}#!${encodeURIComponent(JSON.stringify(fixture))}`);
  await page.waitForFunction(() => window.neuroglancerMobile?.annotations.snapshot().annotationCount === 5);
  await openAnnotations(); await select('point-1');
  await page.getByLabel('Annotation description', { exact: true }).fill('Edited from mobile');
  await coordinate('Position', 0).fill('18');
  await page.getByLabel('Related segments segments', { exact: true }).fill('9007199254740993, 18446744073709551614');
  await save();
  let point = (await snapshot()).annotations.find(a => a.id === 'point-1');
  assert.equal(point.description, 'Edited from mobile'); assert.equal(point.point[0], 18);
  assert.deepEqual(point.segments, [['9007199254740993', '18446744073709551614']]);
  await record('Point description, position, and lossless uint64 segment relations');
  await api(() => window.neuroglancerMobile.annotations.undo());
  point = (await snapshot()).annotations.find(a => a.id === 'point-1');
  assert.equal(point.description, 'Editable point'); assert.equal(point.point[0], 16);
  await api(() => window.neuroglancerMobile.annotations.redo());
  point = (await snapshot()).annotations.find(a => a.id === 'point-1');
  assert.equal(point.description, 'Edited from mobile'); assert.equal(point.point[0], 18);
  await record('Committed annotation changes undo and redo');
  for (const [id, field, dimension, value, property, index] of [
    ['line-1', 'Start', 0, '6', 'pointA', 0], ['box-1', 'End', 1, '20', 'pointB', 1],
    ['ellipsoid-1', 'Radii', 2, '4', 'radii', 2], ['polyline-1', 'Vertex 2', 0, '17', 'points', 1],
  ]) {
    await select(id); await coordinate(field, dimension).fill(value); await save();
    const annotation = (await snapshot()).annotations.find(a => a.id === id);
    assert.equal(property === 'points' ? annotation.points[index][0] : annotation[property][index], Number(value));
  }
  await record('Numeric geometry editor updates all five native annotation shapes');
  await select('polyline-1');
  await page.getByRole('button', { name: 'Add vertex at end', exact: true }).click();
  await coordinate('Vertex 4', 0).waitFor();
  assert.equal((await snapshot()).annotations.find(a => a.id === 'polyline-1').points.length, 4);
  await page.getByRole('button', { name: 'Remove last vertex', exact: true }).click();
  assert.equal((await snapshot()).annotations.find(a => a.id === 'polyline-1').points.length, 3);
  await record('Polyline vertices can be added and removed without a keyboard');

  const beforeRejected = JSON.stringify((await snapshot()).annotations);
  const rejected = await api(async () => {
    const controller = window.neuroglancerMobile.annotations, outcomes = [];
    for (const value of [
      [{ id: 'point-1', type: 'point', point: [1, 2, 3] }],
      [{ id: 'good-before-bad', type: 'point', point: [1, 2, 3] }, { id: 'bad', type: 'point', point: [1, 2] }],
      [{ id: 'duplicate', type: 'point', point: [1, 2, 3] }, { id: 'duplicate', type: 'point', point: [1, 2, 3] }],
      [{ id: 'overflow-id', type: 'point', point: [1, 2, 3], segments: [['18446744073709551616']] }],
    ]) {
      try { await controller.importAnnotations(value); outcomes.push(false); } catch { outcomes.push(true); }
    }
    return outcomes;
  });
  assert.deepEqual(rejected, [true, true, true, true]);
  assert.equal(JSON.stringify((await snapshot()).annotations), beforeRejected);
  await record('Malformed imports, duplicate IDs, and uint64 overflow fail atomically');
  await api(() => window.neuroglancerMobile.annotations.importAnnotations([{ id: 'imported-point', type: 'point', point: [10, 11, 12], description: 'Imported' }]));
  assert.equal((await snapshot()).annotationCount, 6);
  await api(() => window.neuroglancerMobile.annotations.undo()); assert.equal((await snapshot()).annotationCount, 5);
  await api(() => window.neuroglancerMobile.annotations.redo()); assert.equal((await snapshot()).annotationCount, 6);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export layer JSON', exact: true }).click()]);
  const downloadPath = resolve(evidenceDir, `${tag}annotation-editor-export.json`); await download.saveAs(downloadPath);
  const exported = JSON.parse(await readFile(downloadPath));
  assert.equal(exported.type, 'annotation'); assert.equal(exported.annotations.length, 6);
  assert.deepEqual(exported.annotations.find(a => a.id === 'point-1').segments, [['9007199254740993', '18446744073709551614']]);
  await record('Annotation import, undo, redo, and native layer JSON export');

  await api(() => {
    const source = viewer.layerManager.managedLayers.find(layer => layer.layer?.localAnnotations).layer;
    for (const property of [
      { identifier: 'quality', type: 'uint8', default: 0 },
      { identifier: 'reviewed', type: 'bool', default: 0 },
      { identifier: 'color', type: 'rgb', default: 0 },
    ]) source.localAnnotations.addProperty(property);
  });
  await page.waitForFunction(() => window.neuroglancerMobile.annotations.snapshot().undo === 0);
  await select('point-1');
  await page.getByLabel('Property quality', { exact: true }).fill('7');
  await page.getByLabel('Property reviewed', { exact: true }).selectOption('1');
  await page.getByLabel('Property color', { exact: true }).fill('#ff00dd');
  await save();
  point = (await snapshot()).annotations.find(a => a.id === 'point-1');
  assert.deepEqual(point.props, [7, true, '#ff00dd']);
  await record('Native schema edits reset unsafe history and typed properties remain editable');
  await api(() => window.neuroglancerMobile.annotations.setTool('line'));
  await api(() => window.neuroglancerMobile.closePanel());
  assert.equal((await snapshot()).mode, 'line');
  await openAnnotations(); assert.equal((await snapshot()).mode, 'line');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await snapshot()).mode, 'inspect');
  await record('Closing and reopening the annotation sheet preserves active native tools');
  await page.screenshot({ path: resolve(evidenceDir, `${tag}annotation-editor-mobile.png`), fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  const scriptAssets = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src)).catch(() => []);
  await writeFile(resolve(evidenceDir, `${tag}annotation-editor-browser.json`), `${JSON.stringify({ checkedAt: new Date().toISOString(), browser: await browser.version(), url: documentURL.href, buildVersion, scriptAssets, checks, errors }, null, 2)}\n`);
  await browser.close();
}
