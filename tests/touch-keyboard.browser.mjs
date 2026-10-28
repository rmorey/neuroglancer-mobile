import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { chromium } from './browser-runtime.mjs';
import { PROTOTYPE_STATE } from '../state.js';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4174/';
const fixtureBase = process.env.FIXTURE_BASE_URL?.replace(/\/$/, '') || null;
const tag = process.env.EVIDENCE_TAG ? `${process.env.EVIDENCE_TAG}-touch-keyboard` : 'touch-keyboard';
assert.match(tag, /^[a-z0-9-]+$/, 'EVIDENCE_TAG must contain lowercase letters, digits, and hyphens.');
const evidence = resolve(root, process.env.EVIDENCE_DIR || 'test-results'); await mkdir(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), baseURL, fixtureBase, evidenceTag: tag, browser: null, cases: [], errors: [],
  limitations: ['Chromium with touch emulation and software WebGL. Physical iOS and Android not tested.'] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
report.browser = browser.version();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.stack || error.message));

async function run(name, action) {
  const started = Date.now();
  try { const details = await action(); report.cases.push({ name, passed: true, elapsedMs: Date.now() - started, details }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, passed: false, elapsedMs: Date.now() - started, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); await page.screenshot({ path: resolve(evidence, `${tag}-failure-${name}.png`) }).catch(() => {}); }
}
async function keyboard() { return page.evaluate(() => window.neuroglancerMobile.touchKeyboard.snapshot()); }
async function send(code) {
  await page.getByRole('textbox', { name: 'Native key code', exact: true }).fill(code);
  await page.locator('[data-touch-keyboard-send]').tap();
}

try {
  await page.goto(`${baseURL}#!${encodeURIComponent(JSON.stringify(PROTOTYPE_STATE))}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.neuroglancerMobile?.touchKeyboard && window.viewer), null, { timeout: 30000 });
  if (fixtureBase) {
    const manifest = JSON.parse(await readFile(resolve(root, 'tests/fixtures/manifest.json'), 'utf8'));
    await page.evaluate(state => window.neuroglancerMobile.restoreState(state), {
      dimensions: manifest.dimensions, position: [16, 12, 8], crossSectionScale: 0.1,
      layout: 'xy', showAxisLines: true, showDefaultAnnotations: false,
      layers: [{ type: 'image', name: 'Keyboard fixture', source: `precomputed://${fixtureBase}/raw-uint8` }],
    });
  }
  await page.waitForFunction(() => Boolean(window.neuroglancerMobile?.touchKeyboard && window.viewer?.isReady()), null, { timeout: 120000 });
  const layerErrors = await page.evaluate(() => viewer.layerManager.managedLayers.flatMap(managed =>
    [...managed.layer.messages].filter(message => message.severity === 2).map(message => String(message.message))));
  assert.deepEqual(layerErrors, [], 'Native test source reported errors');
  await run('native-axes-and-zoom-via-ui', async () => {
    const before = await page.evaluate(() => ({ axes: viewer.showAxisLines.value, zoom: viewer.crossSectionScale.value }));
    await page.locator('#workspace-toggle').tap();
    await page.getByRole('button', { name: 'Touch keyboard and mouse actions', exact: true }).tap();
    assert.equal(await page.locator('.m-touch-keyboard').isVisible(), true);
    await send('KeyA');
    assert.equal(await page.evaluate(() => viewer.showAxisLines.value), !before.axes);
    await page.locator('[data-touch-modifier="ctrl"]').tap();
    await send('Equal');
    assert.equal(await page.evaluate(() => viewer.crossSectionScale.value), before.zoom / 2);
    assert.equal((await keyboard()).modifiers.ctrl, true);
    await page.locator('[data-touch-keyboard-clear]').tap();
    return { before, after: await page.evaluate(() => ({ axes: viewer.showAxisLines.value, zoom: viewer.crossSectionScale.value })) };
  });

  await run('modifier-capture-excludes-editable-fields', async () => {
    await page.evaluate(() => window.neuroglancerMobile.setAdvanced(true));
    await page.locator('[data-touch-modifier="ctrl"]').tap();
    await page.locator('[data-touch-modifier="alt"]').tap();
    await page.locator('[data-touch-modifier="shift"]').tap();
    const result = await page.evaluate(() => {
      const native = document.querySelector('.neuroglancer-viewer-top-row .neuroglancer-icon');
      const text = [...document.querySelectorAll('.neuroglancer-viewer-top-row input')].find(input => ['text', 'number', 'search'].includes(input.type));
      if (!native || !text) throw new Error('Expected real native icon and editable input in the full top row.');
      const observed = {};
      for (const [name, target] of [['control', native], ['editable', text]]) {
        target.addEventListener('click', event => {
          observed[name] = { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey };
          event.preventDefault(); event.stopImmediatePropagation();
        }, { capture: true, once: true });
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return observed;
    });
    assert.deepEqual(result.control, { ctrl: true, alt: true, shift: true });
    assert.deepEqual(result.editable, { ctrl: false, alt: false, shift: false });
    await page.locator('[data-touch-keyboard-clear]').tap();
    await page.evaluate(() => window.neuroglancerMobile.setAdvanced(false));
    return result;
  });

  await run('explicit-native-right-click', async () => {
    await page.evaluate(() => {
      const panel = [...viewer.display.panels].find(panel => typeof panel.handleMouseMove === 'function' && panel.element.isConnected);
      panel.element.addEventListener('contextmenu', event => {
        window.__keyboardRightClick = { button: event.button, x: event.clientX, y: event.clientY, ctrl: event.ctrlKey };
        event.preventDefault(); event.stopImmediatePropagation();
      }, { capture: true, once: true });
    });
    await page.locator('[data-touch-modifier="ctrl"]').tap();
    await page.locator('[data-touch-click="secondary"]').tap();
    const result = await page.evaluate(() => window.__keyboardRightClick);
    assert.equal(result.button, 2); assert.equal(result.ctrl, true);
    assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y));
    await page.locator('[data-touch-keyboard-clear]').tap();
    return result;
  });

  await run('clear-and-close-release-modifiers', async () => {
    for (const modifier of ['ctrl', 'alt', 'shift']) await page.locator(`[data-touch-modifier="${modifier}"]`).tap();
    assert.deepEqual((await keyboard()).modifiers, { ctrl: true, alt: true, shift: true });
    await page.locator('[data-touch-keyboard-clear]').tap();
    assert.deepEqual((await keyboard()).modifiers, { ctrl: false, alt: false, shift: false });
    await page.locator('[data-touch-modifier="shift"]').tap();
    await page.locator('[data-touch-keyboard-close]').tap();
    const result = await keyboard();
    assert.equal(result.open, false); assert.deepEqual(result.modifiers, { ctrl: false, alt: false, shift: false });
    assert.equal(await page.locator('.m-touch-keyboard').isVisible(), false);
    return result;
  });

  await run('phone-and-landscape-bounds', async () => {
    const samples = [];
    for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.neuroglancerMobile.touchKeyboard.open());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.evaluate(() => {
        const element = document.querySelector('.m-touch-keyboard'), rect = element.getBoundingClientRect();
        return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          targets: [...element.querySelectorAll('button,input')].map(target => { const r = target.getBoundingClientRect(); return { name: target.getAttribute('aria-label'), width: r.width, height: r.height }; }) };
      });
      assert.ok(metrics.rect.x >= 0 && metrics.rect.y >= 0 && metrics.rect.right <= viewport.width && metrics.rect.bottom <= viewport.height);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, 'Keyboard content overflows horizontally');
      assert.ok(metrics.documentWidth <= viewport.width, 'Document overflows horizontally');
      assert.ok(metrics.targets.every(target => target.width >= 44 && target.height >= 44), 'Keyboard has a touch target below 44px');
      samples.push(metrics);
      await page.screenshot({ path: resolve(evidence, `${tag}-${viewport.width}x${viewport.height}.png`) });
    }
    await page.evaluate(() => window.neuroglancerMobile.touchKeyboard.close());
    return samples;
  });

  await run('no-page-errors', async () => { assert.deepEqual(report.errors, []); return { errors: report.errors.length }; });
} catch (error) { report.cases.push({ name: 'startup', passed: false, error: error.stack }); }
finally {
  report.finishedAt = new Date().toISOString(); report.passed = report.cases.every(result => result.passed);
  await writeFile(resolve(evidence, `${tag}-browser-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  await context.close(); await browser.close();
  if (!report.passed) process.exitCode = 1;
}
