import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from './browser-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const documentURL = new URL(process.env.BASE_URL || 'http://127.0.0.1:4174/index.html');
if (documentURL.pathname.endsWith('/')) documentURL.pathname += 'index.html';
const fixtureBase = (process.env.FIXTURE_BASE_URL || `${documentURL.origin}/fixtures`).replace(/\/$/, '');
const dataURL = `${fixtureBase}/spelunker-touch-synthetic`;
const evidence = resolve(root, process.env.EVIDENCE_DIR || 'test-results');
const tag = process.env.EVIDENCE_TAG ? `${process.env.EVIDENCE_TAG}-spelunker-touch` : 'spelunker-touch';
assert.match(tag, /^[a-z0-9-]+$/); await mkdir(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: documentURL.href, cases: [], errors: [], requests: [], unexpectedRequests: [],
  limitations: ['Chromium emulated touch and software WebGL; physical devices and Safari remain unqualified.',
    'Synthetic Graphene service and raw segmentation chunks are intercepted in the browser. No production editing or authentication.'] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
report.browser = browser.version();
const context = await browser.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await context.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', error => report.errors.push(error.stack || error.message));

// Layer-1 IDs are real uint64 base IDs; layer-2 IDs are root representatives.
const leaves = [1n, 2n, 3n, 4n].map(id => String((1n << 56n) + id));
const roots = [1n, 2n, 3n, 4n, 5n].map(id => String((2n << 56n) + id));
const graphOrigin = 'https://spelunker-touch-graph.example.test';
const graphInfo = JSON.parse(await readFile(resolve(root, 'tests/fixtures/segmentation-uint64/info'), 'utf8'));
delete graphInfo.mesh; delete graphInfo.skeletons; delete graphInfo.segment_properties;
Object.assign(graphInfo, { data_dir: dataURL, app: { supported_api_versions: [1] }, graph: { chunk_size: [16, 12, 8], n_bits_for_layer_id: 8 } });
const leafSets = { [roots[0]]: leaves.slice(0, 2), [roots[1]]: leaves.slice(2), [roots[2]]: leaves,
  [roots[3]]: [leaves[0]], [roots[4]]: [leaves[1]] };
let delayEdits = false, releaseEdit;
await context.route(`${dataURL}/**`, async route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/info')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(graphInfo) });
  const match = url.pathname.match(/\/(\d+)-(\d+)_(\d+)-(\d+)_(\d+)-(\d+)$/);
  if (!match) return route.fulfill({ status: 404, body: 'Unknown synthetic chunk' });
  const [x0, x1, y0, y1, z0, z1] = match.slice(1).map(Number);
  const data = Buffer.alloc((x1 - x0) * (y1 - y0) * (z1 - z0) * 8); let offset = 0;
  for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    data.writeBigUint64LE(BigInt(leaves[(x < 16 ? 0 : 2) + (y < 12 ? 0 : 1)]), offset); offset += 8;
  }
  return route.fulfill({ contentType: 'application/octet-stream', body: data });
});
await context.route(`${graphOrigin}/**`, async route => {
  const request = route.request(), url = new URL(request.url());
  const entry = { path: url.pathname, method: request.method(), query: url.search, body: request.postData() }; report.requests.push(entry);
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (url.pathname.endsWith('/info')) return json(graphInfo);
  if (url.pathname.endsWith('/oldest_timestamp')) return json({ iso: '2020-01-01T00:00:00Z' });
  if (url.pathname.endsWith('/is_latest_roots')) return json({ is_latest: request.postDataJSON().node_ids.map(() => true) });
  if (url.pathname.endsWith('/leaves_many')) return json(Object.fromEntries(request.postDataJSON().node_ids.map(id => [id, leafSets[id] || []])));
  if (/\/node\/\d+\/root$/.test(url.pathname)) {
    const id = url.pathname.split('/').at(-2); return json({ root_id: roots[leaves.indexOf(id) < 2 ? 0 : 1] });
  }
  if (url.pathname.endsWith('/table_mapping')) return json({});
  if (url.pathname.endsWith('/graph/find_path')) return json({ centroids_list: [[64, 96, 360], [64, 144, 360]], failed_l2_ids: [] });
  if (url.pathname.endsWith('/merge') || url.pathname.endsWith('/split')) {
    if (delayEdits) await new Promise(resolve => { releaseEdit = resolve; });
    return json({ new_root_ids: url.pathname.endsWith('/merge') ? [roots[2]] : roots.slice(3) });
  }
  report.unexpectedRequests.push(entry); return json({ error: 'Unexpected synthetic request', path: url.pathname }, 404);
});
function state() {
  return { dimensions: { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [45e-9, 'm'] }, position: [16, 12, 8],
    crossSectionScale: 0.1, layout: 'xy', showDefaultAnnotations: false, showAxisLines: false,
    layers: [{ name: 'Touch graph', type: 'segmentation', source: `graphene://${graphOrigin}/segmentation/table/touch`, segments: roots.slice(0, 2), selectedAlpha: 1, notSelectedAlpha: 0 }] };
}
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready() {
  await page.waitForFunction(() => window.neuroglancerMobile?.snapshot().ready && Boolean(viewer.layerManager.getLayerByName('Touch graph')?.layer?.graphConnection?.value), null, { timeout: 60000 });
  await frames();
}
async function restore() {
  releaseEdit?.(); releaseEdit = undefined; delayEdits = false;
  await page.evaluate(value => neuroglancerMobile.restoreState(value), state()); await ready();
  await page.waitForFunction(({ leaves, roots }) => {
    const group = viewer.layerManager.getLayerByName('Touch graph').layer.displayState.segmentationGroupState.value;
    return group.segmentEquivalences.get(BigInt(leaves[0])).toString() === roots[0]
      && group.segmentEquivalences.get(BigInt(leaves[2])).toString() === roots[1];
  }, { leaves, roots });
}
async function activate(name) {
  await page.evaluate(() => neuroglancerMobile.openPanel('spelunker'));
  await page.locator(`[data-spelunker-action="${name}"]`).tap(); await frames();
  assert.equal(await page.evaluate(() => neuroglancerMobile.spelunker.snapshot().active), name);
}
async function graphSnapshot() {
  return page.evaluate(() => {
    const graph = viewer.layerManager.getLayerByName('Touch graph').layer.graphConnection.value;
    const { mergeState: merge, multicutState: cut, findPathState: path } = graph.state;
    const selection = item => item ? { root: String(item.rootId), base: String(item.segmentId), position: Array.from(item.position) } : null;
    return { tool: neuroglancerMobile.spelunker.snapshot(), merge: merge.merges.value.map(item => ({ sink: selection(item.sink), source: selection(item.source), locked: item.locked, status: item.status })),
      red: [...cut.sinks].map(selection), blue: [...cut.sources].map(selection), source: selection(path.source.value), target: selection(path.target.value), centroids: path.centroids.value };
  });
}
async function pickPoint(id) {
  const point = await page.evaluate(id => {
    const layer = viewer.layerManager.getLayerByName('Touch graph').layer;
    const panel = [...viewer.display.panels].find(panel => panel.sliceView && panel.element.checkVisibility());
    if (!panel) throw new Error('No native slice view');
    const rect = panel.element.getBoundingClientRect();
    for (let y = rect.top + 24; y < rect.bottom - 24; y += 14) for (let x = rect.left + 24; x < rect.right - 24; x += 14) {
      const hit = document.elementFromPoint(x, y);
      if (!panel.element.contains(hit) || hit.closest('.m-spelunker-strip,#neuroglancer-status-container')) continue;
      panel.handleMouseMove(x, y); viewer.mouseState.updateUnconditionally();
      if (String(layer.displayState.segmentSelectionState.baseValue) === id) return { x, y, id };
    }
    return null;
  }, id);
  assert.ok(point, `No unobstructed canvas pixel for supervoxel ${id}`); return point;
}
async function tapLeaf(id) { const point = await pickPoint(id); await page.touchscreen.tap(point.x, point.y); await frames(); return point; }
async function run(name, action) {
  const started = Date.now();
  try { const details = await action(); report.cases.push({ name, passed: true, elapsedMs: Date.now() - started, details }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, passed: false, elapsedMs: Date.now() - started, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: resolve(evidence, `${tag}-failure-${name}.png`) }).catch(() => {}); }
}
try {
  await page.goto(`${documentURL.href}#!${encodeURIComponent(JSON.stringify(state()))}`); await ready();
  await run('merge-canvas-taps-submit-once-and-restore-native-selection', async () => {
    await restore();
    const before = await page.evaluate(() => ({ name: viewer.selectedLayer.layer?.name ?? null, visible: viewer.selectedLayer.visible }));
    await activate('merge');
    assert.equal(await page.evaluate(() => viewer.selectedLayer.visible), false, 'Mobile activation obscures the canvas with native layer controls');
    const first = await tapLeaf(leaves[0]), second = await tapLeaf(leaves[2]);
    const pending = await graphSnapshot(); assert.equal(pending.merge.length, 1); assert.equal(pending.merge[0].sink.base, leaves[0]);
    assert.ok(pending.merge[0].source, `Second canvas tap did not finish the native merge line: ${JSON.stringify({ first, second, pending })}`);
    assert.equal(pending.merge[0].source.base, leaves[2]);
    const writesBefore = report.requests.filter(item => item.path.endsWith('/merge')).length;
    delayEdits = true; await page.locator('[data-spelunker-action="submit"]').tap();
    await page.waitForFunction(() => neuroglancerMobile.spelunker.snapshot().busy);
    assert.equal(await page.locator('[data-spelunker-action="submit"]').isDisabled(), true);
    await page.waitForTimeout(100); assert.equal(report.requests.filter(item => item.path.endsWith('/merge')).length, writesBefore + 1);
    releaseEdit(); releaseEdit = undefined; delayEdits = false;
    await page.waitForFunction(() => viewer.layerManager.getLayerByName('Touch graph').layer.graphConnection.value.state.mergeState.merges.value.some(item => item.status === 'done'));
    await page.locator('[data-spelunker-action="cancel"]').tap();
    assert.deepEqual(await page.evaluate(() => ({ name: viewer.selectedLayer.layer?.name ?? null, visible: viewer.selectedLayer.visible })), before);
    return { first, second, pending, writes: report.requests.filter(item => item.path.endsWith('/merge')).length - writesBefore };
  });
  await run('multicut-touch-red-blue-anchors-clear-and-submit', async () => {
    await restore(); await activate('multicut');
    await tapLeaf(leaves[0]); await page.locator('[data-spelunker-action="swap-group"]').tap(); await tapLeaf(leaves[1]);
    let pending = await graphSnapshot(); assert.equal(pending.red.length, 1); assert.equal(pending.blue.length, 1);
    assert.equal(pending.red[0].root, pending.blue[0].root); assert.notEqual(pending.red[0].base, pending.blue[0].base);
    await page.locator('[data-spelunker-action="clear"]').tap();
    const cleared = await graphSnapshot(); assert.equal(cleared.red.length + cleared.blue.length, 0);
    await tapLeaf(leaves[0]); await page.locator('[data-spelunker-action="swap-group"]').tap(); await tapLeaf(leaves[1]);
    pending = await graphSnapshot(); const writesBefore = report.requests.filter(item => item.path.endsWith('/split')).length;
    await page.locator('[data-spelunker-action="submit"]').tap();
    await page.waitForFunction(() => neuroglancerMobile.spelunker.snapshot().active === null);
    const writes = report.requests.filter(item => item.path.endsWith('/split')).slice(writesBefore); assert.equal(writes.length, 1);
    const body = JSON.parse(writes[0].body); assert.equal(body.sources.length, 1); assert.equal(body.sinks.length, 1);
    assert.deepEqual(new Set([body.sources[0][0], body.sinks[0][0]]), new Set(leaves.slice(0, 2)));
    return { pending, request: writes[0] };
  });
  await run('find-path-canvas-endpoints-native-precision-details-and-clear', async () => {
    await restore(); await activate('path'); await tapLeaf(leaves[0]); await tapLeaf(leaves[1]);
    const points = await graphSnapshot(); assert.equal(points.source.base, leaves[0]); assert.equal(points.target.base, leaves[1]);
    await page.locator('[data-spelunker-action="details"]').tap();
    const precision = page.locator('.graphene-find-path input[type="checkbox"]'); await precision.waitFor({ state: 'visible' });
    await precision.uncheck(); assert.equal(await page.evaluate(() => viewer.layerManager.getLayerByName('Touch graph').layer.graphConnection.value.state.findPathState.precisionMode.value), false);
    await page.locator('[data-spelunker-action="details"]').tap();
    await page.locator('[data-spelunker-action="submit"]').tap();
    await page.waitForFunction(() => viewer.layerManager.getLayerByName('Touch graph').layer.graphConnection.value.state.findPathState.centroids.value.length === 2);
    const result = await graphSnapshot(); assert.deepEqual(result.centroids, [[8, 12, 8], [8, 18, 8]]);
    await page.locator('[data-spelunker-action="clear"]').tap();
    const cleared = await graphSnapshot(); assert.equal(cleared.source, null); assert.equal(cleared.target, null); assert.equal(cleared.centroids.length, 0);
    await page.locator('[data-spelunker-action="cancel"]').tap(); return { points, result };
  });
  await run('tool-drag-pans-without-placing-endpoints', async () => {
    await restore(); await activate('path'); const point = await pickPoint(leaves[0]);
    const position = await page.evaluate(() => Array.from(viewer.position.value));
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: point.x, y: point.y }] });
      for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: point.x + i * 8, y: point.y + i * 3 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
    await frames(); const after = await graphSnapshot(); assert.equal(after.source, null); assert.equal(after.target, null);
    assert.notDeepEqual(await page.evaluate(() => Array.from(viewer.position.value)), position);
    await page.locator('[data-spelunker-action="cancel"]').tap();
  });
  await run('touch-toolbar-portrait-landscape-fit-and-targets', async () => {
    const metrics = [];
    for (const viewport of [{ width: 360, height: 640 }, { width: 800, height: 360 }]) {
      await page.setViewportSize(viewport); await restore(); await activate('multicut');
      const sample = await page.evaluate(() => {
        const strip = document.querySelector('.m-spelunker-strip'), rect = strip.getBoundingClientRect();
        return { viewport: [innerWidth, innerHeight], rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
          overflow: document.documentElement.scrollWidth > innerWidth,
          buttons: [...strip.querySelectorAll('button')].filter(element => element.checkVisibility()).map(element => { const box = element.getBoundingClientRect(); return { text: element.textContent, width: box.width, height: box.height }; }) };
      });
      assert.equal(sample.overflow, false); assert.ok(sample.rect.x >= 0 && sample.rect.y >= 0 && sample.rect.right <= viewport.width && sample.rect.bottom <= viewport.height);
      assert.ok(sample.buttons.every(button => button.width >= 44 && button.height >= 44), JSON.stringify(sample)); metrics.push(sample);
      await page.screenshot({ path: resolve(evidence, `${tag}-${viewport.width}x${viewport.height}.png`) });
      await page.locator('[data-spelunker-action="cancel"]').tap();
    }
    return metrics;
  });
  await run('no-page-errors-or-unhandled-synthetic-requests', async () => {
    assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedRequests, []);
    return { errors: report.errors.length, intercepted: report.requests.length };
  });
} catch (error) { report.cases.push({ name: 'startup', passed: false, error: error.stack }); }
finally {
  releaseEdit?.(); report.finishedAt = new Date().toISOString(); report.passed = report.cases.every(result => result.passed);
  await writeFile(resolve(evidence, `${tag}-browser.json`), `${JSON.stringify(report, null, 2)}\n`);
  await context.close(); await browser.close(); if (!report.passed) process.exitCode = 1;
}
