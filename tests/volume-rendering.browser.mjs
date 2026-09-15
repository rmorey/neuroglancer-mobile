import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from './browser-runtime.mjs';
const base = (process.env.BASE_URL || process.env.NG_TEST_URL || 'http://127.0.0.1:4174').replace(/\/$/, '');
const documentURL = new URL(/\.html?$/i.test(base) ? base : `${base}/index.html`);
const fixtureBase = (process.env.FIXTURE_BASE_URL || new URL('fixtures', documentURL).href).replace(/\/$/, '');
const tag = process.env.EVIDENCE_TAG ? `${process.env.EVIDENCE_TAG}-` : '';
assert.match(tag, /^[a-z0-9-]*$/);
const evidence = resolve(import.meta.dirname, '..', process.env.EVIDENCE_DIR || 'test-results');
const manifest = JSON.parse(await readFile(new URL('./fixtures/manifest.json', import.meta.url)));
const engine = JSON.parse(await readFile(new URL('../UPSTREAM.json', import.meta.url)));
await mkdir(evidence, { recursive: true });
const report = {
  checkedAt: new Date().toISOString(), url: documentURL.href, upstreamPin: engine.commit, fixtureSourcePin: manifest.upstreamPin,
  fixture: 'raw-uint8', shape: manifest.shape, checks: [], errors: [], console: [], responses: [],
  semantics: 'Native slice opacity is separate from volume opacity. Volume opacity uses shader alpha and volumeRenderingGain.',
  limitations: ['Chromium mobile emulation with software WebGL; physical phones and native iOS Safari remain untested.'],
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push({ message: error.message, stack: error.stack }));
page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
page.on('response', response => {
  if (response.url().startsWith(fixtureBase)) report.responses.push({ url: response.url(), status: response.status() });
});
const shader = (color, alpha) => `void main() { float value = toNormalized(getDataValue()); emitRGBA(vec4(${color.map(c => `${c.toFixed(1)} * value`).join(', ')}, ${alpha.toFixed(4)} * value)); }`;
const layer = (color = [1, 0, 0], alpha = 0.1, gain = 0) => ({ type: 'image', name: 'Volume fixture',
  source: `precomputed://${fixtureBase}/raw-uint8`, volumeRendering: true, volumeRenderingGain: gain,
  volumeRenderingDepthSamples: 256, shader: shader(color, alpha) });
const state = image => ({ dimensions: manifest.dimensions, position: [16, 12, 8],
  crossSectionScale: 0.1, projectionScale: 100, layout: '3d',
  projectionOrientation: [0.1830127, 0.1830127, 0.0490381, 0.9641016],
  showSlices: false, showAxisLines: false, showScaleBar: false, showDefaultAnnotations: false,
  projectionBackgroundColor: '#000000', layers: [image] });
async function frames() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function ready() {
  await frames();
  await page.waitForFunction(() => window.viewer?.isReady() && window.neuroglancerMobile?.snapshot().ready,
    null, { timeout: 90000, polling: 100 });
  await frames();
  const messages = await page.evaluate(() => viewer.layerManager.managedLayers.flatMap(managed =>
    [...managed.layer.messages].filter(message => message.severity === 2).map(message => String(message.message))));
  assert.deepEqual(messages, []);
}
async function restore(value) {
  await page.evaluate(value => window.neuroglancerMobile.restoreState(value), value);
  await ready();
}
async function currentPanel() {
  return page.evaluate(() => {
    const panels = [...viewer.display.panels].filter(panel => panel.element.checkVisibility());
    const panel = panels.find(panel => !panel.sliceView) || panels[0];
    if (!panel) throw new Error('No native data panel');
    const rect = panel.element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, slice: Boolean(panel.sliceView) };
  });
}
async function visiblePixels(label) {
  await frames();
  const panel = await currentPanel();
  const screenshot = await page.screenshot({ path: resolve(evidence, `${tag}volume-${label}.png`), type: 'png' });
  return page.evaluate(async ({ encoded, panel }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: 'image/png' }));
    const ratio = bitmap.width / innerWidth, canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, (panel.x + panel.width * 0.1) * ratio, (panel.y + panel.height * 0.1) * ratio,
      panel.width * 0.8 * ratio, panel.height * 0.8 * ratio, 0, 0, 256, 256);
    bitmap.close();
    const data = ctx.getImageData(0, 0, 256, 256).data;
    const sum = [0, 0, 0]; let redPixels = 0, greenPixels = 0, hash = 2166136261, nonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        sum[channel] += data[i + channel]; hash = Math.imul(hash ^ data[i + channel], 16777619) >>> 0;
      }
      if (data[i] > data[i + 1] + 10 && data[i] > data[i + 2] + 10) redPixels++;
      if (data[i + 1] > data[i] + 10 && data[i + 1] > data[i + 2] + 10) greenPixels++;
      if (Math.max(data[i], data[i + 1], data[i + 2]) > 10) nonBlack++;
    }
    return { panel, rgbMean: sum.map(value => value / 65536), redPixels, greenPixels, nonBlack, hash: hash.toString(16) };
  }, { encoded: screenshot.toString('base64'), panel });
}
async function record(name, details) {
  report.checks.push({ name, pass: true, details }); console.log(`PASS ${name}`);
  await writeFile(resolve(evidence, `${tag}volume-rendering-browser.json`), `${JSON.stringify(report, null, 2)}\n`);
}
const quaternionDistance = (a, b) => Math.min(Math.hypot(...a.map((x, i) => x - b[i])), Math.hypot(...a.map((x, i) => x + b[i])));
async function touchSequence(points) {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points[0] });
    for (const touchPoints of points.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
  await ready();
}
try {
  report.browser = browser.version();
  report.buildVersion = await (await page.request.get(new URL('version.json', documentURL).href)).json();
  await page.goto(`${documentURL.href}#!${encodeURIComponent(JSON.stringify(state(layer())))}`, { waitUntil: 'domcontentloaded' });
  await ready();
  const native = await page.evaluate(() => ({ state: viewer.state.toJSON(),
    layers: viewer.layerManager.managedLayers[0].layer.renderLayers.map(layer => layer.constructor.name),
    panels: [...viewer.display.panels].filter(panel => panel.element.checkVisibility()).map(panel => ({ slice: Boolean(panel.sliceView) })) }));
  assert.equal(native.state.showSlices, false);
  assert.equal(native.state.showDefaultAnnotations, false);
  assert.equal(native.state.layers[0].volumeRendering, 'on');
  assert.equal(native.panels.length, 1);
  assert.equal(native.panels[0].slice, false);
  const red = await visiblePixels('red');
  assert.ok(red.redPixels > 100, `No substantial visible red volume pixels: ${JSON.stringify(red)}`);
  const chunks = report.responses.filter(response => /\/raw-uint8\/[^/]+\/\d+-\d+_\d+-\d+_\d+-\d+$/.test(response.url));
  assert.ok(chunks.length > 0 && chunks.every(response => response.status === 200));
  await record('Ray-marched raw uint8 volume is visible with slice planes and annotation bounds disabled', { native, red, chunks });

  await restore(state(layer([0, 1, 0])));
  const green = await visiblePixels('green');
  assert.ok(green.greenPixels > 100 && green.redPixels === 0, `Shader color did not update volume: ${JSON.stringify(green)}`);
  assert.notEqual(red.hash, green.hash);
  await record('Native shader color changes visible volume pixels', { red, green });

  await restore(state(layer([0, 1, 0], 0)));
  const transparent = await visiblePixels('transparent');
  assert.equal(transparent.greenPixels, 0);
  assert.ok(transparent.rgbMean[1] < green.rgbMean[1] * 0.1);
  await record('Zero shader alpha makes the volume transparent', { green, transparent });

  await restore(state(layer([0, 1, 0], 0.1, -5)));
  const lowGain = await visiblePixels('low-gain');
  assert.ok(lowGain.rgbMean[1] > transparent.rgbMean[1]);
  assert.ok(lowGain.rgbMean[1] < green.rgbMean[1] * 0.75);
  await record('Native volume gain changes opacity independently of slice opacity', { green, lowGain, transparent });

  await restore(state(layer([1, 0, 0])));
  const panel3D = await currentPanel(), center3D = [panel3D.x + panel3D.width / 2, panel3D.y + panel3D.height / 2];
  const before3D = await page.evaluate(() => Array.from(viewer.projectionOrientation.orientation));
  await touchSequence(Array.from({ length: 9 }, (_, step) => [{ id: 0, x: center3D[0] - 40 + step * 10, y: center3D[1] - 20 + step * 5 }]));
  const after3D = await page.evaluate(() => Array.from(viewer.projectionOrientation.orientation));
  assert.ok(quaternionDistance(before3D, after3D) > 0.05);
  const rotated = await visiblePixels('touch-rotated'); assert.notEqual(rotated.hash, red.hash);
  await record('One-finger touch drag rotates the native 3D camera and rendered volume', { before3D, after3D, rotated });

  await restore({ ...state({ ...layer(), volumeRendering: false }), layout: 'xy',
    crossSectionOrientation: [0.2588190451, 0, 0, 0.9659258263] });
  const panel2D = await currentPanel(), center2D = [panel2D.x + panel2D.width / 2, panel2D.y + panel2D.height / 2];
  const before2D = await page.evaluate(() => Array.from(viewer.crossSectionOrientation.orientation));
  await touchSequence(Array.from({ length: 13 }, (_, step) => {
    const angle = step / 12 * Math.PI / 3;
    return [0, 1].map(id => ({ id, x: center2D[0] + (id ? 1 : -1) * 65 * Math.cos(angle),
      y: center2D[1] + (id ? 1 : -1) * 65 * Math.sin(angle) }));
  }));
  const after2D = await page.evaluate(() => Array.from(viewer.crossSectionOrientation.orientation));
  assert.ok(quaternionDistance(before2D, after2D) > 0.1);
  await visiblePixels('touch-rotated-slice');
  assert.ok(Math.hypot(after2D[0], after2D[1]) > 0.2, 'Touch rotation lost the oblique section orientation');
  await record('Two-finger touch rotation changes orientation within an oblique native cross-section', { before2D, after2D });
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  report.failure.state = await page.evaluate(() => viewer.state.toJSON()).catch(() => null);
  await page.screenshot({ path: resolve(evidence, `${tag}volume-failure.png`) }).catch(() => {});
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  report.scriptAssets = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src)).catch(() => []);
  await writeFile(resolve(evidence, `${tag}volume-rendering-browser.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
