import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '..');
import { chromium } from './browser-runtime.mjs';
import { PROTOTYPE_STATE } from '../state.js';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4174/';
const fixtureBase = (process.env.FIXTURE_BASE_URL || new URL('/fixtures/', baseURL).href).replace(/\/$/, '');
const tag = process.env.EVIDENCE_TAG || 'full-local';
assert.match(tag, /^[a-z0-9-]+$/);
const evidence = resolve(root, process.env.EVIDENCE_DIR || 'test-results'); await mkdir(evidence, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(here, 'fixtures/manifest.json'), 'utf8'));
const engine = JSON.parse(await readFile(resolve(root, 'UPSTREAM.json'), 'utf8'));
const requested = process.env.CASES?.split(',');
const report = { startedAt: new Date().toISOString(), baseURL, fixtureBase, upstreamPin: engine.commit, fixtureSourcePin: manifest.upstreamPin,
  device: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  cases: [], console: [], errors: [], failedRequests: [], responses: [], warnings: [],
  limitations: ['Chromium mobile emulation on software WebGL; physical iOS/Android and cellular performance untested.', 'WebKit is not tested.'] };
let phase = 'startup', browser, context, page;
const snapshot = target => target.evaluate(() => window.neuroglancerMobile.snapshot());
const exportState = target => target.evaluate(() => window.neuroglancerMobile.exportState());
const source = (name, protocol = 'precomputed') => `${protocol}://${fixtureBase}/${name}`;
const baseState = (layers, extra = {}) => ({ dimensions: manifest.dimensions, position: [16, 12, 8],
  crossSectionScale: 0.1, projectionScale: 512, layout: '4panel', showAxisLines: false, showDefaultAnnotations: false,
  layers, ...extra });
const imageLayer = (name, type = 'uint8', protocol = 'precomputed') => ({ type: 'image', name,
  source: source(name, protocol), shader: `void main() { emitGrayscale(${type === 'float32' ? '(getDataValue() + 4.0) / 8.0' : 'toNormalized(getDataValue())'}); }` });
function attach(target) {
  target.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ phase, type: message.type(), text: message.text() }); });
  target.on('pageerror', error => report.errors.push({ phase, message: error.message, stack: error.stack }));
  target.on('requestfailed', request => report.failedRequests.push({ phase, url: request.url(), error: request.failure()?.errorText }));
  target.on('response', response => { if (response.url().startsWith(fixtureBase) || response.status() >= 400) report.responses.push({ phase, url: response.url(), status: response.status() }); });
}
async function persist() { await writeFile(resolve(evidence, `${tag}-browser-report.json`), JSON.stringify(report, null, 2) + '\n'); }
async function frames(target = page) { await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready(target = page, timeout = 90000) {
  await frames(target);
  await target.waitForFunction(() => window.viewer?.isReady() && window.neuroglancerMobile?.snapshot().ready, null, { timeout, polling: 100 });
  await frames(target);
  const messages = await target.evaluate(() => window.viewer.layerManager.managedLayers.flatMap(managed =>
    [...managed.layer.messages].filter(message => message.severity === 2).map(message => ({ layer: managed.name, message: String(message.message) }))));
  assert.deepEqual(messages, [], 'Native layer reported errors');
  return snapshot(target);
}
async function restore(state, target = page) {
  if (await target.locator('#mobile-panel').isVisible()) await target.locator('#panel-close').click();
  await target.evaluate(state => window.neuroglancerMobile.restoreState(state), state);
  return ready(target);
}
async function pixels(target = page) {
  return target.evaluate(() => {
    const viewer = window.viewer; viewer.display.draw();
    const gl = viewer.gl, width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const bytes = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let sum = 0, square = 0, count = 0, hash = 2166136261, min = 255, max = 0;
    const step = Math.max(1, Math.floor(width * height / 100000));
    for (let pixel = 0; pixel < width * height; pixel += step) {
      const value = Math.max(bytes[pixel * 4], bytes[pixel * 4 + 1], bytes[pixel * 4 + 2]);
      hash = Math.imul(hash ^ value, 16777619) >>> 0; sum += value; square += value * value; count++; min = Math.min(min, value); max = Math.max(max, value);
    }
    return { width, height, hash: hash.toString(16), variance: square / count - (sum / count) ** 2, mean: sum / count, min, max };
  });
}
async function visibleImagePixels() {
  const panel = (await currentPanels())[0];
  assert.ok(panel, 'No visible slice panel for screenshot validation');
  const screenshot = await page.screenshot({ type: 'png' });
  return page.evaluate(async ({ encoded, panel }) => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const ratio = bitmap.width / innerWidth;
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, (panel.x + panel.width * 0.2) * ratio, (panel.y + panel.height * 0.25) * ratio,
      panel.width * 0.45 * ratio, panel.height * 0.5 * ratio, 0, 0, 128, 128);
    bitmap.close();
    const data = ctx.getImageData(0, 0, 128, 128).data; let sum = 0, square = 0, min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) { const v = data[i]; sum += v; square += v * v; min = Math.min(min, v); max = Math.max(max, v); }
    const count = 128 * 128; return { mean: sum / count, variance: square / count - (sum / count) ** 2, min, max };
  }, { encoded: screenshot.toString('base64'), panel });
}
async function sample(name, position) {
  await page.evaluate(position => { window.viewer.position.value = new Float32Array(position); }, position);
  await ready();
  await page.waitForFunction(({ name, position }) => {
    const layer = window.viewer.layerManager.getLayerByName(name)?.layer;
    return layer?.renderLayers.some(render => render.getValueAt?.(new Float32Array(position)) != null);
  }, { name, position }, { timeout: 20000 });
  return page.evaluate(({ name, position }) => {
    const renderLayers = window.viewer.layerManager.getLayerByName(name).layer.renderLayers;
    const value = renderLayers.map(render => render.getValueAt?.(new Float32Array(position))).find(value => value != null);
    return typeof value === 'bigint' ? value.toString() : value;
  }, { name, position });
}
async function test(name, callback) {
  if (requested && !requested.some(prefix => name.startsWith(prefix))) return;
  phase = name; const started = Date.now(); console.log(`RUN ${name}`);
  try { const details = await callback(); report.cases.push({ name, passed: true, elapsedMs: Date.now() - started, details }); console.log(`PASS ${name}`); }
  catch (error) {
    const diagnostics = await page.evaluate(() => ({ viewer: window.neuroglancerMobile?.snapshot(), annotations: window.neuroglancerMobile?.annotations?.snapshot() })).catch(() => null);
    report.cases.push({ name, passed: false, elapsedMs: Date.now() - started, error: error.stack, diagnostics }); console.error(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: resolve(evidence, `${tag}-failure-${name}.png`) }).catch(() => {});
  }
  await persist();
}
async function currentPanels() {
  return page.evaluate(() => [...window.viewer.display.panels].filter(panel => panel.sliceView && panel.element.checkVisibility()).map(panel => {
    const rect = panel.element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
}
async function closePanel() { if (await page.locator('#mobile-panel').isVisible()) await page.locator('#panel-close').tap(); }

try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || process.env.AGENT_BROWSER_EXECUTABLE_PATH, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version(); context = await browser.newContext({ ...report.device, permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage(); attach(page);
  await test('default-opens-empty', async () => {
    const requests = []; const record = request => { if (!request.url().startsWith(new URL(baseURL).origin)) requests.push(request.url()); };
    page.on('request', record);
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.viewer && window.neuroglancerMobile), null, { timeout: 30000 });
    await page.waitForTimeout(1500); page.off('request', record);
    const state = await exportState(page);
    // Stock Neuroglancer behavior: an empty viewer offers the native new-layer source dialog.
    assert.deepEqual(state.layers, [{ type: 'new', source: '', tab: 'source', name: 'new layer' }]);
    assert.ok(await page.evaluate(() => window.viewer.selectedLayer.location.visible));
    assert.deepEqual(requests, [], 'The bare URL must not fetch any data source');
    for (const id of ['play', 'fit', 'home', 'slice-prev', 'slice-next']) assert.ok(await page.locator(`#${id}`).isDisabled(), `${id} must be disabled without data`);
    assert.equal(await page.locator('.m-brand-subtitle').textContent(), 'Volume workspace');
    await page.locator('#layers-toggle').tap(); assert.equal(await page.getByRole('button', { name: 'Full layer controls' }).count(), 0, 'The add-layer placeholder is not a data layer'); await closePanel();
    await page.screenshot({ path: resolve(evidence, `${tag}-empty-phone.png`) }); return { layout: state.layout };
  });
  await page.goto(`${baseURL}#!${encodeURIComponent(JSON.stringify(PROTOTYPE_STATE))}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.viewer && window.neuroglancerMobile), null, { timeout: 30000 });
  await test('live-mec-upstream-engine', async () => {
    const current = await ready(); const image = await pixels();
    assert.ok(image.variance > 10 && image.max - image.min > 80, 'WebGL does not contain visible image detail');
    const screenshotPixels = await visibleImagePixels();
    assert.ok(screenshotPixels.variance > 30 && screenshotPixels.max - screenshotPixels.min > 30, 'Browser screenshot obscures the WebGL image');
    const state = await exportState(page);
    assert.ok(JSON.stringify(state).includes('mec_alignment_2025-09/alignment/img/v2'));
    assert.ok(await page.evaluate(() => Boolean(window.viewer.gl.getExtension('EXT_color_buffer_float'))));
    await page.screenshot({ path: resolve(evidence, `${tag}-mec-phone.png`) }); return { current, image, screenshotPixels };
  });
  for (const [name, type, key] of [['raw-uint8', 'uint8', 'uint8'], ['raw-uint16', 'uint16', 'uint16'], ['raw-float32', 'float32', 'float32']]) {
    await test(`image-${type}`, async () => {
      await restore(baseState([imageLayer(name, type)])); const samples = [];
      for (const expected of manifest.expectedSamples) { const actual = await sample(name, expected.position); assert.equal(actual, expected[key]); samples.push({ position: expected.position, actual }); }
      const image = await pixels(); assert.ok(image.max > image.min); return { samples, image };
    });
  }
  await test('offset-and-truncated-edge-chunks', async () => {
    const name = 'offset-edge-uint8'; await restore(baseState([imageLayer(name)], { position: [3, 13, 15] }));
    const samples = [];
    for (const [position, expected] of [[[-5, 7, 11], 0], [[11, 19, 19], (16 * 7 + 12 * 11 + 8 * 13) % 256]]) {
      const actual = await sample(name, position); assert.equal(actual, expected); samples.push({ position, actual });
    }
    return samples;
  });
  await test('sharded-http-range', async () => {
    const name = 'sharded-uint8'; await restore(baseState([imageLayer(name)], { position: [4, 4, 4] }));
    assert.equal(await sample(name, [4, 4, 4]), (4 * 7 + 4 * 11 + 4 * 13) % 256);
    const ranges = report.responses.filter(response => response.phase === phase && response.url.endsWith('.shard'));
    assert.ok(ranges.length > 0 && ranges.every(response => response.status === 206), 'Shard reads did not use HTTP 206'); return { ranges };
  });
  for (const name of ['segmentation-uint64', 'compressed-segmentation-uint64']) {
    await test(name, async () => {
      await restore(baseState([{ type: 'segmentation', name, source: source(name), segments: manifest.ids, selectedAlpha: 0.75 }]));
      const samples = [];
      for (const expected of manifest.expectedSamples) { const actual = await sample(name, expected.position); assert.equal(actual, expected.uint64); samples.push({ position: expected.position, actual }); }
      await page.evaluate(name => window.neuroglancerMobile.setSegments(name, ['9007199254740993']), name); await ready();
      const layer = (await exportState(page)).layers.find(layer => layer.name === name);
      // Native state retains deselected entries with a leading ! marker.
      assert.deepEqual(layer.segments.filter(id => !id.startsWith('!')), ['9007199254740993']);
      return { samples, layer, image: await pixels() };
    });
  }
  await test('mesh-skeleton-properties-3d', async () => {
    const name = 'objects'; await restore(baseState([{ type: 'segmentation', name, source: source('segmentation-uint64'), segments: manifest.ids }], { layout: '3d' }));
    const image = await pixels(); assert.ok(image.max - image.min > 30, '3D mesh/skeleton view is blank');
    const loadedURLs = report.responses.filter(response => response.status === 200).map(response => response.url);
    assert.ok(loadedURLs.some(url => url.includes('/mesh/') && url.endsWith('-tetrahedron')));
    assert.ok(loadedURLs.some(url => url.includes('/skeletons/') && url.endsWith('9007199254740993')));
    const properties = await page.evaluate(() => {
      const state = window.viewer.layerManager.getLayerByName('objects').layer.displayState.segmentationGroupState.value;
      const properties = state.segmentPropertyMap.value;
      return { present: Boolean(properties), json: JSON.stringify(properties, (_, value) => typeof value === 'bigint' ? value.toString() : value) };
    });
    assert.ok(properties.present && properties.json.includes('Above safe integer'));
    await page.screenshot({ path: resolve(evidence, `${tag}-objects-3d.png`) }); return { image, properties };
  });
  for (const name of ['zarr-v2-uint16', 'zarr-v3-uint16']) {
    await test(name, async () => {
      await restore(baseState([imageLayer(name, 'uint16', 'zarr')])); const samples = [];
      for (const expected of manifest.expectedSamples) { const actual = await sample(name, expected.position); assert.equal(actual, expected.uint16); samples.push({ position: expected.position, actual }); }
      return { samples, state: await exportState(page) };
    });
  }
  for (const dataset of manifest.datasets.filter(dataset => dataset.annotationType)) {
    await test(`read-${dataset.name}`, async () => {
      const name = dataset.name; await restore(baseState([{ type: 'annotation', name, source: source(name) }]));
      const annotation = await page.evaluate(async ({ name, id }) => {
        const states = window.viewer.layerManager.getLayerByName(name).layer.annotationStates.states;
        const source = states.find(state => state.source.getReference && state.source.metadataChunkSource)?.source;
        if (!source) throw new Error('Remote native annotation source was not activated');
        const reference = source.getReference(id);
        try {
          const deadline = performance.now() + 15000;
          while (reference.value === undefined && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
          if (!reference.value) throw new Error('Annotation by-id request did not resolve');
          return JSON.parse(JSON.stringify(reference.value, (_, value) => typeof value === 'bigint' ? value.toString() : ArrayBuffer.isView(value) ? Array.from(value) : value));
        } finally { reference.dispose(); }
      }, { name, id: dataset.annotationId });
      assert.equal(annotation.id, dataset.annotationId);
      assert.ok(JSON.stringify(annotation).includes(dataset.relatedSegment));
      return { annotation, state: await exportState(page) };
    });
  }
  await test('local-five-geometry-native-roundtrip', async () => {
    const state = JSON.parse(await readFile(resolve(here, 'fixtures/editable-annotation-state.json'), 'utf8'));
    await restore(state); const exported = await exportState(page); const annotations = exported.layers[0].annotations;
    assert.equal(annotations.length, 5); assert.equal(new Set(annotations.map(annotation => annotation.type)).size, 5);
    await restore(exported); assert.deepEqual((await exportState(page)).layers[0].annotations, annotations);
    return { annotations };
  });
  await test('touch-create-five-annotation-geometries', async () => {
    await restore(baseState([imageLayer('raw-uint8'), { type: 'annotation', name: 'Touch annotations', source: 'local://annotations', annotations: [] }], { layout: 'xy' }));
    const creations = [];
    for (const [mode, expectedType, points] of [
      ['point', 'point', [[-30, -30]]], ['line', 'line', [[-35, -15], [30, 25]]],
      ['box', 'axis_aligned_bounding_box', [[-30, -25], [30, 25]]], ['ellipsoid', 'ellipsoid', [[0, 0], [30, 25]]],
      ['polyline', 'polyline', [[-35, -25], [0, 25], [35, -25]]],
    ]) {
      console.log(`ANNOTATE ${mode}`);
      await page.locator('#annotations-toggle').tap();
      await page.locator(`[data-annotation-tool="${mode}"]`).tap();
      await page.waitForFunction(mode => window.neuroglancerMobile.annotations.snapshot().mode === mode, mode);
      await closePanel(); await ready();
      const rect = (await currentPanels())[0], center = [rect.x + rect.width / 2, rect.y + rect.height / 2];
      for (const [dx, dy] of points) { await page.touchscreen.tap(center[0] + dx, center[1] + dy); await frames(); await page.waitForTimeout(100); }
      if (mode === 'polyline') await page.locator('#tool-finish').tap();
      await page.waitForFunction(count => { const state = window.neuroglancerMobile.annotations.snapshot(); return state.annotationCount === count && state.pending === 0; }, creations.length + 1, { timeout: 10000 });
      const current = await page.evaluate(() => window.neuroglancerMobile.annotations.snapshot());
      assert.ok(current.annotations.some(annotation => annotation.type === expectedType)); creations.push({ mode, current });
    }
    const exported = await exportState(page); const rows = exported.layers.find(layer => layer.name === 'Touch annotations').annotations;
    assert.equal(rows.length, 5);
    await page.screenshot({ path: resolve(evidence, `${tag}-touch-annotations.png`) });
    await restore(exported); assert.deepEqual((await exportState(page)).layers.find(layer => layer.name === 'Touch annotations').annotations, rows);
    return { creations, annotations: rows };
  });
  await test('touch-annotation-cancel-and-delete', async () => {
    const annotations = JSON.parse(await readFile(resolve(here, 'fixtures/editable-annotation-state.json'), 'utf8')).layers[0];
    await restore(baseState([imageLayer('raw-uint8'), annotations], { layout: 'xy' }));
    await page.locator('#annotations-toggle').tap(); await page.locator('[data-annotation-tool="line"]').tap(); await closePanel(); await ready();
    const rect = (await currentPanels())[0]; await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.waitForFunction(() => window.neuroglancerMobile.annotations.snapshot().pending > 0);
    await page.locator('#tool-cancel').tap();
    const cancelled = await page.evaluate(() => window.neuroglancerMobile.annotations.snapshot()); assert.equal(cancelled.pending, 0); assert.equal(cancelled.annotationCount, 5);
    await page.locator('#annotations-toggle').tap(); await page.locator('[data-annotation-id="point-1"]').tap();
    await page.getByRole('button', { name: 'Delete selected', exact: true }).tap();
    await page.waitForFunction(() => window.neuroglancerMobile.annotations.snapshot().annotationCount === 4);
    const deleted = await page.evaluate(() => window.neuroglancerMobile.annotations.snapshot());
    assert.ok(deleted.annotations.every(annotation => annotation.id !== 'point-1')); await closePanel();
    return { cancelled, deleted };
  });
  await test('touch-annotation-move-and-tap-delete', async () => {
    await restore(baseState([imageLayer('raw-uint8'), { type: 'annotation', name: 'Move point', source: 'local://annotations',
      annotations: [{ id: 'move-point', type: 'point', point: [16, 12, 8] }] }], { layout: 'xy' }));
    await page.locator('#annotations-toggle').tap(); await page.locator('[data-annotation-tool="move"]').tap(); await closePanel(); await ready();
    const rect = (await currentPanels())[0], center = [rect.x + rect.width / 2, rect.y + rect.height / 2];
    await page.touchscreen.tap(...center);
    await page.waitForFunction(() => window.neuroglancerMobile.annotations.snapshot().moving, null, { timeout: 5000 });
    const destination = [center[0] + 35, center[1] + 25]; await page.touchscreen.tap(...destination);
    await page.waitForFunction(() => !window.neuroglancerMobile.annotations.snapshot().moving);
    const moved = await page.evaluate(() => window.neuroglancerMobile.annotations.snapshot());
    assert.equal(moved.annotations[0].id, 'move-point'); assert.notDeepEqual(moved.annotations[0].point, [16, 12, 8]);
    await page.locator('#annotations-toggle').tap(); await page.locator('[data-annotation-tool="delete"]').tap(); await closePanel(); await ready();
    await page.touchscreen.tap(...destination);
    await page.waitForFunction(() => window.neuroglancerMobile.annotations.snapshot().annotationCount === 0, null, { timeout: 5000 });
    return { moved, deleted: await page.evaluate(() => window.neuroglancerMobile.annotations.snapshot()) };
  });
  await test('all-native-layouts', async () => {
    await restore(baseState([imageLayer('raw-uint8')])); const results = [];
    for (const layout of ['xy', 'xz', 'yz', '3d', '4panel', '4panel-alt', 'xy-3d', 'xz-3d', 'yz-3d']) {
      await page.locator('#layout-select').selectOption(layout); await ready();
      const current = await snapshot(page); assert.ok(JSON.stringify(current.layout).includes(layout)); results.push({ layout: current.layout, position: current.position });
    }
    return results;
  });
  await test('real-touch-pan-pinch-and-section-controls', async () => {
    await restore(baseState([imageLayer('raw-uint8')], { layout: 'xy', crossSectionScale: 0.1 }));
    const panel = (await currentPanels())[0]; assert.ok(panel, 'No native slice panel');
    const x = panel.x + panel.width * 0.4, y = panel.y + panel.height * 0.4;
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 })) });
    const initial = await exportState(page);
    await touch('touchStart', [[1, x - 30, y], [2, x + 30, y]]);
    await touch('touchCancel', []);
    await frames();
    await touch('touchStart', [[1, x, y]]);
    for (let step = 1; step <= 6; step++) { await touch('touchMove', [[1, x + step * 6, y + step * 3]]); await page.waitForTimeout(20); }
    await touch('touchEnd', []); await ready(); const panned = await exportState(page); assert.notDeepEqual(panned.position, initial.position);
    await touch('touchStart', [[1, x - 35, y], [2, x + 35, y]]);
    for (let step = 1; step <= 6; step++) { await touch('touchMove', [[1, x - 35 - step * 5, y], [2, x + 35 + step * 5, y]]); await page.waitForTimeout(20); }
    await touch('touchEnd', []); await ready(); const pinched = await exportState(page); assert.ok(pinched.crossSectionScale < panned.crossSectionScale);
    await page.locator('#axis-select').selectOption('z');
    await page.locator('#slice-next').tap(); await ready(); const next = await exportState(page); assert.equal(next.position[2], pinched.position[2] + 1);
    await page.locator('#axis-select').selectOption('x'); await page.locator('#slice-step').selectOption('10');
    await page.locator('#slice-prev').tap(); await ready();
    const stepped = await exportState(page); assert.equal(stepped.position[0], next.position[0] - 10);
    await cdp.detach(); return { initial, panned, pinched, next, stepped };
  });
  await test('mobile-layer-form', async () => {
    await restore(baseState([imageLayer('raw-uint8')])); await page.locator('#layers-toggle').tap();
    await page.locator('#layer-name').fill('Form uint16'); await page.locator('#layer-source').fill(source('raw-uint16'));
    await page.locator('#layer-type').selectOption('image'); await page.locator('#add-layer').tap(); await closePanel(); await ready();
    const layer = (await exportState(page)).layers.find(layer => layer.name === 'Form uint16'); assert.ok(layer); assert.ok(JSON.stringify(layer.source).includes('/raw-uint16'));
    return layer;
  });
  await test('native-state-share-and-workspace-import', async () => {
    const annotations = JSON.parse(await readFile(resolve(here, 'fixtures/editable-annotation-state.json'), 'utf8')).layers[0];
    await restore(baseState([imageLayer('raw-uint16', 'uint16'), { type: 'segmentation', name: 'Labels', source: source('compressed-segmentation-uint64'), segments: ['9007199254740993'], selectedAlpha: 0.35 }, annotations],
      { position: [17, 5, 8], layout: 'xy-3d', crossSectionOrientation: [0, 0, 0.258819045, 0.965925826] }));
    const before = await exportState(page); await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.locator('#share').tap();
    // Share writes the clipboard asynchronously; wait for the new link rather than reading a stale one.
    let shared = '';
    for (const end = Date.now() + 10000; !shared.includes('#!') && Date.now() < end; await page.waitForTimeout(100)) shared = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(shared.includes('#!'));
    const clean = await context.newPage(); attach(clean);
    let restored;
    try {
      await clean.goto(shared); await clean.waitForFunction(() => Boolean(window.neuroglancerMobile)); await ready(clean);
      restored = await exportState(clean);
      for (const key of ['layers', 'dimensions', 'position', 'layout', 'crossSectionOrientation', 'crossSectionScale', 'projectionScale']) assert.deepEqual(restored[key], before[key], `${key} was lost through native share`);
    } finally { await clean.close(); }
    await page.locator('#workspace-toggle').tap(); await page.locator('#state-import').fill(JSON.stringify(before));
    await page.getByRole('button', { name: 'Import state', exact: true }).tap(); await ready();
    assert.deepEqual((await exportState(page)).layers, before.layers); return { shared, restored };
  });
  await test('layer-rename-reorder-opacity-visibility-removal', async () => {
    await restore(baseState([imageLayer('raw-uint8'), imageLayer('raw-uint16', 'uint16')], { layout: 'xy' }));
    await page.locator('#layers-toggle').tap();
    // Range inputs must show the layer's value, not one snapped to the default step of 1.
    assert.equal(await page.getByLabel('Opacity', { exact: true }).first().inputValue(), '0.5');
    await page.getByLabel('Show raw-uint8', { exact: true }).uncheck();
    await page.getByLabel('Layer name raw-uint8', { exact: true }).fill('Renamed EM');
    await page.getByLabel('Layer name raw-uint8', { exact: true }).press('Tab');
    await page.getByLabel('Opacity', { exact: true }).first().evaluate(input => { input.value = '0.25'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    let state = await exportState(page); let renamed = state.layers.find(layer => layer.name === 'Renamed EM');
    assert.ok(renamed); assert.equal(renamed.visible, false); assert.equal(renamed.opacity, 0.25);
    await page.getByRole('button', { name: 'Move raw-uint16 up', exact: true }).tap();
    state = await exportState(page); assert.equal(state.layers[0].name, 'raw-uint16');
    await page.getByRole('button', { name: 'Remove', exact: true }).first().tap();
    assert.equal((await exportState(page)).layers.length, 1);
    await page.getByRole('button', { name: 'Undo last removal', exact: true }).tap();
    state = await exportState(page); assert.equal(state.layers.length, 2); assert.ok(state.layers.some(layer => layer.name === 'raw-uint16'));
    await closePanel(); await ready(); return state;
  });
  await test('native-commands-orientation-and-state-download', async () => {
    await restore(baseState([imageLayer('raw-uint8')], { layout: 'xy' }));
    await page.locator('#workspace-toggle').tap(); await page.getByRole('button', { name: 'Commands', exact: true }).tap();
    await page.locator('.neuroglancer-command-palette-input').fill('zoom');
    await page.waitForFunction(() => document.querySelectorAll('.neuroglancer-command-palette-row').length > 0);
    const commands = await page.locator('.neuroglancer-command-palette-row').allTextContents(); await page.keyboard.press('Escape');
    await page.locator('#workspace-toggle').tap(); await page.getByLabel('Slice quaternion', { exact: true }).fill('0, 0, 0.3826834324, 0.9238795325');
    await page.getByRole('button', { name: 'Apply slice quaternion', exact: true }).tap(); await closePanel(); await ready();
    const oriented = await exportState(page); assert.ok(Math.abs(oriented.crossSectionOrientation[2]) > 0.3);
    await page.locator('#orientation-reset').tap(); await ready();
    const reset = await exportState(page); assert.ok(reset.crossSectionOrientation == null || Math.abs(reset.crossSectionOrientation[2]) < 1e-6);
    await page.locator('#workspace-toggle').tap(); await page.getByRole('button', { name: 'Native state editor', exact: true }).tap();
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).tap();
    const downloaded = await downloading; assert.equal(downloaded.suggestedFilename(), 'state.json');
    await downloaded.saveAs(resolve(evidence, `${tag}-native-state-download.json`));
    const stateFile = JSON.parse(await readFile(resolve(evidence, `${tag}-native-state-download.json`), 'utf8'));
    assert.ok(stateFile.layers.some(layer => layer.name === 'raw-uint8'));
    await page.getByRole('button', { name: 'Close', exact: true }).tap(); return { commands, oriented, reset, downloadedLayers: stateFile.layers };
  });
  await test('malformed-native-hash-preserves-workspace', async () => {
    await restore(baseState([imageLayer('raw-uint16', 'uint16')], { layout: 'xz', position: [17, 5, 8] }));
    const before = await exportState(page);
    await page.evaluate(() => { location.hash = '!%7Bbroken-state'; }); await page.waitForTimeout(500);
    const after = await exportState(page); assert.deepEqual(after.layers, before.layers); assert.deepEqual(after.position, before.position);
    await page.evaluate(() => { location.hash = '!' + encodeURIComponent(JSON.stringify({ dimensions: { x: ['not-a-number', 'm'] }, layers: [] })); });
    await page.waitForTimeout(500); const afterRestoreFailure = await exportState(page);
    assert.deepEqual(afterRestoreFailure.layers, before.layers); assert.deepEqual(afterRestoreFailure.position, before.position);
    await restore(before);
    await page.locator('#toast').waitFor({ state: 'hidden', timeout: 10000 });
    return { before, after, afterRestoreFailure };
  });
  await test('touch-native-keyboard-and-sticky-modifier', async () => {
    await restore(baseState([imageLayer('raw-uint8')], { layout: 'xy' }));
    const rect = (await currentPanels())[0];
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const before = await exportState(page);
    await page.locator('#workspace-toggle').tap();
    await page.getByRole('button', { name: 'Touch keyboard and mouse actions', exact: true }).tap();
    await page.getByRole('dialog', { name: 'Native keyboard controls', exact: true }).waitFor({ state: 'visible' });
    await page.locator('[data-touch-key="ArrowRight"]').tap(); await ready();
    const navigated = await exportState(page);
    assert.ok(navigated.position[0] > before.position[0], 'Native ArrowRight did not move x');
    await page.locator('[data-touch-modifier="ctrl"]').tap();
    await page.getByLabel('Native key code', { exact: true }).fill('Equal');
    await page.locator('[data-touch-keyboard-send]').tap(); await ready();
    const zoomed = await exportState(page);
    assert.ok(zoomed.crossSectionScale < navigated.crossSectionScale, 'Native Ctrl+Equal did not zoom');
    await page.locator('[data-touch-keyboard-close]').tap();
    const keyboard = await page.evaluate(() => window.neuroglancerMobile.touchKeyboard.snapshot());
    assert.equal(keyboard.open, false); assert.deepEqual(keyboard.modifiers, { ctrl: false, alt: false, shift: false });
    return { before, navigated, zoomed, keyboard };
  });
  await test('responsive-workspace-panels', async () => {
    await restore(baseState([imageLayer('raw-uint8')], { layout: 'xy' })); const layouts = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport); await ready();
      const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        controls: [...document.querySelectorAll('.m-header button,.m-bottom button,.m-bottom input,.m-bottom select,.m-quicknav button')].filter(element => element.checkVisibility()).map(element => {
          const r = element.getBoundingClientRect(); return { id: element.id, x: r.x, y: r.y, w: r.width, h: r.height };
        }) }));
      assert.ok(metrics.scrollWidth <= metrics.width);
      for (const control of metrics.controls) {
        assert.ok(control.w >= 43.9 && control.h >= 43.9, `${control.id} touch target is ${control.w}x${control.h}`);
        assert.ok(control.x >= -0.1 && control.y >= -0.1 && control.x + control.w <= metrics.width + 0.1 && control.y + control.h <= metrics.height + 0.1, `${control.id} is clipped`);
      }
      layouts.push(metrics);
      for (const toggle of ['#layers-toggle', '#workspace-toggle', '#help-toggle', '#annotations-toggle']) {
        await page.locator(toggle).tap(); await page.locator('#mobile-panel').waitFor({ state: 'visible' });
        const panel = await page.locator('#mobile-panel').boundingBox(); assert.ok(panel && panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width + 1 && panel.y + panel.height <= viewport.height + 1);
        await closePanel();
      }
      if (viewport.width === 844) await page.screenshot({ path: resolve(evidence, `${tag}-landscape.png`) });
    }
    await page.setViewportSize(report.device.viewport); await ready(); return layouts;
  });
  await test('native-controls-remain-reachable', async () => {
    await page.locator('#advanced-toggle').tap(); assert.equal(await page.locator('#advanced-toggle').getAttribute('aria-pressed'), 'true');
    await page.locator('.neuroglancer-viewer-top-row').waitFor({ state: 'visible' });
    await page.locator('.neuroglancer-layer-panel').waitFor({ state: 'visible' });
    const native = await page.locator('#neuroglancer-container').innerText(); assert.ok(native.includes('raw-uint8'), 'Native layer controls are not visible');
    await page.screenshot({ path: resolve(evidence, `${tag}-native-controls.png`) });
    await page.locator('#advanced-toggle').tap(); return { nativeText: native.slice(0, 2500) };
  });
  await test('unexpected-runtime-errors', async () => {
    assert.deepEqual(report.errors, [], 'Uncaught page/worker errors');
    const expectedDiscovery = response => response.status === 404 && (
      response.url === `${fixtureBase}/zarr-v2-uint16/zarr.json` ||
      response.url === `${fixtureBase}/zarr-v3-uint16/.zarray` || response.url === `${fixtureBase}/zarr-v3-uint16/.zattrs`);
    const discovery404s = report.responses.filter(expectedDiscovery);
    const discoveryPhases = new Set(discovery404s.map(item => item.phase));
    const errors = report.console.filter(item => item.type === 'error' && !(item.text.includes('404') && discoveryPhases.has(item.phase)));
    assert.deepEqual(errors, [], 'Unexpected console errors');
    assert.deepEqual(report.responses.filter(item => item.status >= 400 && !expectedDiscovery(item)), [], 'Unexpected HTTP error responses');
    return { warnings: report.console.filter(item => item.type === 'warning'), discovery404s };
  });
} catch (error) { report.fatal = error.stack; console.error(error.stack); }
finally {
  report.finishedAt = new Date().toISOString(); report.passed = !report.fatal && report.cases.every(item => item.passed);
  await persist(); await browser?.close();
  console.log(`${report.cases.filter(item => item.passed).length}/${report.cases.length} full-engine cases passed: ${resolve(evidence, `${tag}-browser-report.json`)}`);
  process.exitCode = report.passed ? 0 : 1;
}
