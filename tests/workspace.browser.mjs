import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from './browser-runtime.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:4174/';
const fixture = process.env.FIXTURE_BASE_URL || `${new URL(base).origin}/fixtures`;
const evidence = resolve(import.meta.dirname, '..', process.env.EVIDENCE_DIR || 'test-results'); await mkdir(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), base, cases: [], errors: [] };
const browser = await chromium.launch({ executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
const state = { dimensions: { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [45e-9, 'm'] }, position: [16, 12, 8], crossSectionScale: 0.2, layout: 'xy', layers: [{ name: 'Test image', type: 'image', source: `precomputed://${fixture}/raw-uint8` }] };
const current = () => page.evaluate(() => neuroglancerMobile.exportState());
async function ready() { await page.waitForFunction(() => window.neuroglancerMobile?.snapshot().ready, null, { timeout: 60000 }); }
async function reset() { await page.evaluate(s => { neuroglancerMobile.closePanel(); neuroglancerMobile.restoreState(s); }, state); await ready(); }
async function test(name, action) { try { await action(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (e) { report.cases.push({ name, passed: false, error: e.stack }); console.error(`FAIL ${name}: ${e.message}`); await page.screenshot({ path: `${evidence}/workspace-failure-${name}.png` }); } }
try {
  await page.goto(`${base}#!${encodeURIComponent(JSON.stringify(state))}`); await ready();
  await test('state-json-import-export-and-rejected-input', async () => {
    await page.locator('#workspace-toggle').tap();
    await page.locator('#state-import').fill('{broken'); await page.getByRole('button', { name: 'Import state', exact: true }).tap();
    assert.deepEqual((await current()).position, state.position);
    const imported = { ...state, position: [7, 8, 9], layout: { type: 'row', children: [{ type: 'viewer', layers: ['Test image'], layout: 'xy' }, { type: 'viewer', layers: ['Test image'], layout: '3d' }] } };
    await page.locator('#state-import').fill(JSON.stringify(imported)); await page.getByRole('button', { name: 'Import state', exact: true }).tap(); await ready();
    assert.deepEqual((await current()).position, imported.position); assert.equal((await current()).layout.type, 'row');
    await page.locator('#workspace-toggle').tap(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON', exact: true }).tap();
    assert.equal((await download).suggestedFilename(), 'neuroglancer-state.json');
  });
  await test('bookmarks-restore-complete-native-state', async () => {
    await reset(); await page.locator('#workspace-toggle').tap(); await page.locator('#bookmark-name').fill('Saved native view'); await page.getByRole('button', { name: 'Save view', exact: true }).tap();
    await page.evaluate(() => { viewer.position.value = new Float32Array([3, 4, 5]); });
    await page.getByRole('button', { name: 'Saved native view', exact: true }).tap(); assert.deepEqual((await current()).position, state.position);
  });
  await test('share-link-reopens-native-state', async () => {
    await reset(); await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await page.locator('#share').tap(); const text = await page.evaluate(() => navigator.clipboard.readText()); assert.ok(text.includes('#!'));
    const second = await context.newPage(); await second.goto(text); await second.waitForFunction(() => window.neuroglancerMobile?.snapshot().ready);
    assert.deepEqual(await second.evaluate(() => neuroglancerMobile.exportState().position), state.position); await second.close();
  });
  await test('layer-opacity-order-visibility-remove-undo', async () => {
    await reset(); await page.evaluate(s => neuroglancerMobile.addLayer('Second', s.layers[0]), state); await ready();
    await page.locator('#layers-toggle').tap(); await page.getByLabel('Show Second', { exact: true }).uncheck();
    assert.equal((await current()).layers[1].visible, false);
    await page.getByRole('button', { name: 'Move Second up', exact: true }).tap(); assert.equal((await current()).layers[0].name, 'Second');
    await page.getByRole('slider', { name: 'Opacity', exact: true }).first().fill('0.3'); assert.equal((await current()).layers[0].opacity, 0.3);
    await page.getByRole('button', { name: 'Remove', exact: true }).first().tap(); assert.equal((await current()).layers.length, 1);
    await page.getByRole('button', { name: 'Undo last removal', exact: true }).tap(); assert.equal((await current()).layers.length, 2);
  });
  await test('native-panels-and-command-palette', async () => {
    await reset(); await page.locator('#workspace-toggle').tap(); await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    await page.locator('.neuroglancer-side-panel').filter({ visible: true }).first().waitFor();
    await page.locator('#workspace-toggle').tap(); await page.getByRole('button', { name: 'Commands', exact: true }).tap();
    await page.locator('.neuroglancer-command-palette').waitFor(); await page.keyboard.press('Escape');
    await page.evaluate(() => { for (const state of [viewer.settingsPanelState, viewer.selectedLayer]) state.location.visible = false; });
  });
  await test('native-state-editor-download', async () => {
    await reset(); await page.locator('#workspace-toggle').tap(); await page.getByRole('button', { name: 'Native state editor', exact: true }).tap();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).tap(); assert.equal((await download).suggestedFilename(), 'state.json'); await page.keyboard.press('Escape');
  });
  await test('native-screenshot-download', async () => {
    await reset(); await page.locator('#screenshot').tap(); await page.waitForTimeout(700);
    await page.screenshot({ path: `${evidence}/workspace-screenshot-dialog.png` });
    assert.ok(await page.locator('.overlay').count());
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Take screenshot', exact: true }).tap();
    assert.match((await download).suggestedFilename(), /\.png$/); await page.keyboard.press('Escape');
  });
  await test('home-preserves-imported-dimensions', async () => {
    await reset(); await page.locator('#home').tap(); assert.ok((await current()).position[0] < 100);
    const four = structuredClone(state); four.dimensions.t = [1, 's']; four.position.push(5);
    four.layers.push({ name: 'Time annotations', type: 'annotation', source: 'local://annotations', annotations: [{ id: 'time-point', type: 'point', point: [16, 12, 8, 5] }] });
    await page.evaluate(s => neuroglancerMobile.restoreState(s), four); await ready();
    await page.locator('#fit').tap(); assert.equal((await current()).position.length, 4); assert.equal((await current()).position[3], 5);
  });
  await test('runtime-clean', async () => assert.deepEqual(report.errors, []));
} finally { report.finishedAt = new Date().toISOString(); await writeFile(`${evidence}/${process.env.EVIDENCE_TAG ? `${process.env.EVIDENCE_TAG}-workspace` : 'workspace'}-browser.json`, JSON.stringify(report, null, 2)); await browser.close(); }
if (report.cases.some(c => !c.passed)) process.exitCode = 1;
