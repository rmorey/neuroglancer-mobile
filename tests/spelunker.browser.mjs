import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from './browser-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const documentURL = new URL(process.env.BASE_URL || 'http://127.0.0.1:4174/index.html');
if (documentURL.pathname.endsWith('/')) documentURL.pathname += 'index.html';
const fixture = process.env.FIXTURE_BASE_URL || `${documentURL.origin}/fixtures`;
const evidence = resolve(root, process.env.EVIDENCE_DIR || 'test-results');
const tag = process.env.EVIDENCE_TAG ? `${process.env.EVIDENCE_TAG}-spelunker` : 'spelunker';
assert.match(tag, /^[a-z0-9-]+$/);
await mkdir(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: documentURL.href, cases: [], errors: [],
  limitations: ['Chromium touch emulation with software WebGL; physical devices and Safari not qualified.',
    'CAVE state sharing, terms acceptance, and Graphene requests use intercepted synthetic services. No real authentication or production writes.'] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
report.browser = browser.version();
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true,
  permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.stack || error.message));
page.setDefaultTimeout(15000);
const stamp = Date.parse('2024-03-01T12:34:56Z');
const state = {
  dimensions: { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [45e-9, 'm'] },
  position: [16, 12, 8], crossSectionScale: 0.2, layout: 'xy',
  layers: [{ type: 'segmentation', name: 'Segments', source: `precomputed://${fixture}/segmentation-uint64`,
    segments: ['1', '9007199254740993'], timestamp: stamp, timestampOwner: ['Segments'] },
  { type: 'annotation', name: 'Review', source: 'local://annotations',
    linkedSegmentationLayer: 'Segments', swapVisbleSegmentsOnMove: false,
    annotationProperties: [{ id: 'reviewed', type: 'bool', default: false }, { id: 'uncertain', type: 'bool', default: false }],
    annotations: [{ id: 'a', type: 'point', point: [8, 8, 4], props: [true, false], segments: [['9007199254740993']], description: 'Reviewed annotation' },
      { id: 'b', type: 'point', point: [22, 16, 12], props: [false, true], segments: [['1']], description: 'Uncertain annotation' }] }],
};
function legacy() {
  const result = structuredClone(state), segmentation = result.layers[0], annotation = result.layers[1];
  segmentation.source = { url: segmentation.source, state: { timestamp: stamp } };
  delete segmentation.timestamp;
  annotation.tab = 'tags';
  annotation.annotationProperties = [
    { id: 'tag0', tag: 'Reviewed', type: 'uint8', default: 0, enum_values: [0, 1], enum_labels: ['no', 'yes'] },
    { id: 'tag1', tag: 'Uncertain', type: 'uint8', default: 0, enum_values: [0, 1], enum_labels: ['no', 'yes'] },
  ];
  annotation.shader = 'void main() { setColor(prop_tag0() ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)); }';
  annotation.toolBindings = { Q: 'tagTool_tag0' };
  annotation.annotations.forEach(a => { a.props = a.props.map(Number); });
  return result;
}
const current = target => (target || page).evaluate(() => neuroglancerMobile.exportState());
async function ready(target = page) { await target.waitForFunction(() => window.neuroglancerMobile?.snapshot().ready, null, { timeout: 60000 }); }
async function open(value = state) {
  await page.goto(`${documentURL.href}#!${encodeURIComponent(JSON.stringify(value))}`);
  await ready();
}
async function restore(value = state) {
  await page.evaluate(s => {
    document.querySelector('.neuroglancer-state-editor .close-button')?.click();
    for (const button of document.querySelectorAll('#neuroglancer-status-container button')) if (button.textContent === 'Dismiss') button.click();
    neuroglancerMobile.closePanel(); neuroglancerMobile.restoreState(s); viewer.deactivateTools();
  }, value);
  await ready();
}
async function nativeLayer(name, tab) {
  await page.evaluate(({ name, tab }) => {
    neuroglancerMobile.closePanel();
    const managed = viewer.layerManager.getLayerByName(name);
    viewer.selectedLayer.layer = managed;
    managed.layer.panels.panels[0].selectedTab.value = tab;
    viewer.selectedLayer.location.restoreState({ side: 'bottom', row: 0, col: 0, size: 450, visible: true });
  }, { name, tab });
}
function assertMigrated(value) {
  const segments = value.layers.find(layer => layer.name === 'Segments'), review = value.layers.find(layer => layer.name === 'Review');
  assert.equal(segments.timestamp, stamp);
  assert.deepEqual(segments.timestampOwner, ['Segments']);
  assert.equal(review.swapVisbleSegmentsOnMove, false);
  assert.ok(review.annotationProperties.every(property => property.type === 'bool' && !('tag' in property)));
  const id = review.annotationProperties[0].id;
  assert.ok(review.shader.includes(`prop_${id}()`));
  assert.ok(!review.shader.includes('prop_tag0()'));
  assert.equal(typeof review.toolBindings.Q, 'object');
  assert.ok(JSON.stringify(review.toolBindings.Q).includes(id));
  assert.notEqual(review.tab, 'tags');
  assert.equal(review.annotations[0].props[0], true);
  return { timestamp: segments.timestamp, properties: review.annotationProperties, tool: review.toolBindings.Q };
}
async function test(name, action) {
  const start = Date.now();
  try { const details = await action(); report.cases.push({ name, passed: true, elapsedMs: Date.now() - start, details }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, passed: false, elapsedMs: Date.now() - start, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: resolve(evidence, `${tag}-failure-${name}.png`) }).catch(() => {}); }
}

// All synthetic service traffic stays inside browser routing. The real CAVE
// service is never contacted, even if a route handler encounters an error.
const caveOrigin = 'https://global.daf-apis.com';
const loginOrigin = 'https://spelunker-auth.example.test';
let sharedState, statePosts = [], requireTos = false, tosAttempts = 0;
await context.addInitScript(({ loginOrigin, caveOrigin }) => {
  localStorage.setItem(`auth_token_v2_${loginOrigin}`, JSON.stringify({ tokenType: 'Bearer', accessToken: 'synthetic-browser-test-token',
    url: loginOrigin, appUrls: [caveOrigin] }));
}, { loginOrigin, caveOrigin });
await context.route(`${caveOrigin}/**`, async route => {
  const request = route.request(), url = new URL(request.url());
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (url.pathname === '/auth_info') return json({ login_url: loginOrigin });
  if (url.pathname === '/nglstate/api/v1/post' && request.method() === 'POST') {
    statePosts.push({ state: request.postDataJSON(), authorization: request.headers().authorization === 'Bearer synthetic-browser-test-token' });
    if (requireTos && tosAttempts++ === 0) return route.fulfill({ status: 403, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'missing_tos', data: { tos_form_url: `${loginOrigin}/tos`, tos_name: 'Synthetic CAVE dataset' } }) });
    sharedState = request.postDataJSON();
    return json(`${caveOrigin}/nglstate/api/v1/42`);
  }
  if (url.pathname === '/nglstate/api/v1/42') return json(sharedState);
  return json({ error: 'Unexpected synthetic CAVE request', path: url.pathname }, 404);
});
await context.route(`${loginOrigin}/**`, route => route.fulfill({ contentType: 'text/html', body:
  '<!doctype html><title>Synthetic Terms</title><button onclick="window.opener.postMessage(\'success\',\'*\')">Accept synthetic terms</button>' }));

const graphOrigin = 'https://spelunker-graph.example.test';
const graphRequests = [];
const graphInfo = JSON.parse(await readFile(resolve(root, 'tests/fixtures/segmentation-uint64/info'), 'utf8'));
delete graphInfo.mesh; delete graphInfo.skeletons; delete graphInfo.segment_properties;
Object.assign(graphInfo, { data_dir: `${fixture}/segmentation-uint64`, app: { supported_api_versions: [1] }, graph: { chunk_size: [16, 12, 8], n_bits_for_layer_id: 8 } });
await context.route(`${graphOrigin}/**`, async route => {
  const request = route.request(), url = new URL(request.url());
  graphRequests.push({ path: url.pathname, query: url.search, method: request.method(), body: request.postData() });
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (url.pathname.endsWith('/info')) return json(graphInfo);
  if (url.pathname.endsWith('/oldest_timestamp')) {
    if (url.pathname.includes('/unavailable/')) return json({ error: 'Synthetic unavailable timestamp endpoint' }, 404);
    if (url.pathname.includes('/invalid-time/')) return json({ iso: 'invalid synthetic timestamp' });
    return json({ iso: '2020-01-01T00:00:00Z' });
  }
  if (/\/node\/\d+\/root$/.test(url.pathname)) return json({ root_id: '72057594037927937' });
  if (url.pathname.endsWith('/is_latest_roots')) return json({ is_latest: request.postDataJSON().node_ids.map(() => true) });
  if (url.pathname.endsWith('/table_mapping')) return json({});
  if (url.pathname.includes('/node/')) return json({ node_ids: [] });
  return json({ error: 'Unexpected synthetic graph request', path: url.pathname }, 404);
});
const graphState = () => ({ ...structuredClone(state), layers: [{ name: 'Graph', type: 'segmentation',
  source: `graphene://${graphOrigin}/segmentation/table/test`, timestamp: stamp, timestampOwner: ['Graph'], segments: [] }] });

try {
  await test('spelunker-state-roundtrip', async () => {
    await open(); const first = await current(); await restore(first); const second = await current();
    for (const value of [first, second]) {
      assert.equal(value.layers[0].timestamp, stamp); assert.deepEqual(value.layers[0].timestampOwner, ['Segments']);
      assert.equal(value.layers[1].swapVisbleSegmentsOnMove, false);
      assert.deepEqual(value.layers[1].annotations[0].segments, [['9007199254740993']]);
    }
    return { timestamp: second.layers[0].timestamp, timestampOwner: second.layers[0].timestampOwner, swap: second.layers[1].swapVisbleSegmentsOnMove };
  });
  await test('legacy-fragment-upgrades-timestamp-shader-tags-tools', async () => { await open(legacy()); return assertMigrated(await current()); });
  await test('legacy-json-import-upgrades-before-restoration', async () => {
    await restore(); await page.evaluate(() => neuroglancerMobile.openPanel('workspace'));
    await page.locator('#state-import').fill(JSON.stringify(legacy()));
    await page.getByRole('button', { name: 'Import state', exact: true }).tap(); await ready();
    return assertMigrated(await current());
  });
  await test('legacy-named-layer-map-upgrades-without-data-loss', async () => {
    const named = legacy(); named.layers = Object.fromEntries(named.layers.map(({ name, ...layer }) => [name, layer]));
    await restore(named); return assertMigrated(await current());
  });
  await test('legacy-remote-state-upgrades-through-url-binding', async () => {
    sharedState = legacy(); await page.goto(`${documentURL.href}#!middleauth+${caveOrigin}/nglstate/api/v1/42`); await ready();
    return assertMigrated(await current());
  });
  await test('invalid-import-retains-spelunker-state', async () => {
    await restore(); const before = await current();
    const outcome = await page.evaluate(() => {
      const bad = neuroglancerMobile.exportState(); bad.dimensions = { x: ['not-a-number', 'm'] }; bad.layers[0].timestamp = 1;
      try { neuroglancerMobile.restoreState(bad); return false; } catch { return true; }
    });
    assert.equal(outcome, true); const after = await current();
    assert.deepEqual(after.layers, before.layers); assert.deepEqual(after.position, before.position); assert.deepEqual(after.layout, before.layout);
  });
  await test('native-state-editor-upgrade-and-rollback', async () => {
    await restore(); await page.evaluate(() => viewer.editJsonState());
    const editor = page.locator('.neuroglancer-state-editor .CodeMirror');
    await editor.waitFor(); await editor.evaluate((element, value) => element.CodeMirror.setValue(JSON.stringify(value)), legacy());
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click(); await ready();
    assertMigrated(await current()); const before = await current();
    await editor.evaluate((element, value) => element.CodeMirror.setValue(JSON.stringify({ ...value, title: 'Rejected state', dimensions: { x: ['not-a-number', 'm'] }, position: [1, 2, 3] })), before);
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.getByText('Unable to apply state:', { exact: false }).waitFor();
    const after = await current(); assert.deepEqual(after.layers, before.layers); assert.deepEqual(after.position, before.position);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  });
  await test('url-and-native-editor-restores-stop-section-playback', async () => {
    for (const method of ['url', 'native-editor']) {
      await restore(); await page.locator('#play').tap();
      assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true');
      const imported = structuredClone(state); imported.title = `Restored via ${method}`; imported.position = [7, 6, 5];
      if (method === 'url') {
        await page.evaluate(value => { location.hash = `!${encodeURIComponent(JSON.stringify(value))}`; }, imported);
      } else {
        await page.evaluate(() => viewer.editJsonState());
        await page.locator('.neuroglancer-state-editor .CodeMirror').evaluate((element, value) => element.CodeMirror.setValue(JSON.stringify(value)), imported);
        await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
      }
      await page.waitForFunction(title => viewer.title.value === title, imported.title);
      await ready(); assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
      await page.waitForTimeout(650);
      assert.deepEqual((await current()).position, imported.position);
    }
  });
  await test('native-boolean-summary-and-associated-segment-navigation', async () => {
    await restore(); await nativeLayer('Review', 'annotations');
    const summary = page.locator('.neuroglancer-annotation-boolean-properties').filter({ hasText: '#reviewed' });
    await summary.waitFor(); assert.ok((await summary.textContent()).includes('#reviewed'));
    await page.evaluate(() => { viewer.layerManager.getLayerByName('Review').layer.annotationDisplayState.swapVisibleSegmentsOnMove.value = true; });
    await summary.evaluate(element => element.parentElement.dispatchEvent(new CustomEvent('action:move-to-annotation', { bubbles: true, cancelable: true })));
    const result = await current(); assert.deepEqual(result.position, [8, 8, 4]);
    const segments = await page.evaluate(() => [...viewer.layerManager.getLayerByName('Segments').layer.displayState.segmentationGroupState.value.visibleSegments].map(String));
    assert.deepEqual(segments, ['9007199254740993']);
    await page.screenshot({ path: resolve(evidence, `${tag}-native-annotation-summary.png`) });
    return { position: result.position, visibleSegments: segments };
  });
  await test('native-segment-color-picker-persists-color', async () => {
    await restore(); await nativeLayer('Segments', 'segments');
    const picker = page.locator('.neuroglancer-segment-list-entry[data-id="1"] .neuroglancer-segment-list-entry-color-input').first();
    await picker.waitFor(); assert.equal(await picker.evaluate(e => getComputedStyle(e).display !== 'none'), true);
    const id = await picker.evaluate(e => e.closest('.neuroglancer-segment-list-entry').dataset.id);
    await picker.fill('#ff00dd');
    assert.equal((await current()).layers[0].segmentColors[id], '#ff00dd');
    return { id, color: '#ff00dd' };
  });
  await test('spelunker-shortcuts-clear-segments-with-modifiers', async () => {
    await restore(); await page.evaluate(() => { neuroglancerMobile.closePanel(); viewer.selectedLayer.layer = viewer.layerManager.getLayerByName('Segments'); viewer.selectedLayer.location.visible = false; viewer.element.focus(); });
    const mappings = await page.evaluate(() => Object.fromEntries(['keym', 'keyc', 'keyf', 'keyx', 'control+shift+keyx', 'bracketleft', 'bracketright'].map(key => [key, viewer.inputEventBindings.global.get(`at:${key}`)?.action || null])));
    assert.equal(mappings.keym, 'tool-grapheneMergeSegments'); assert.equal(mappings.keyc, 'tool-grapheneMulticutSegments'); assert.equal(mappings.keyf, 'tool-grapheneFindPath');
    assert.equal(mappings.keyx, null); assert.equal(mappings['control+shift+keyx'], 'clear-segments');
    assert.equal(mappings.bracketleft, 'select-previous'); assert.equal(mappings.bracketright, 'select-next');
    await page.keyboard.press('KeyX'); assert.equal((await current()).layers[0].segments.length, 2);
    await page.keyboard.press('Control+Shift+KeyX');
    const visible = await page.evaluate(() => [...viewer.layerManager.getLayerByName('Segments').layer.displayState.segmentationGroupState.value.visibleSegments]);
    assert.equal(visible.length, 0); return mappings;
  });
  await test('graphene-historical-root-request-and-edit-guards', async () => {
    await restore(graphState());
    await page.waitForFunction(() => Boolean(viewer.layerManager.getLayerByName('Graph')?.layer?.graphConnection?.value));
    const rootId = await page.evaluate(async () => {
      const layer = viewer.layerManager.getLayerByName('Graph').layer;
      return String(await layer.graphConnection.value.graph.getRoot(9007199254740993n, layer.displayState.segmentationGroupState.value.timestamp.value));
    });
    assert.equal(rootId, '72057594037927937');
    const rootRequest = graphRequests.find(request => request.path.includes('/node/9007199254740993/root'));
    assert.equal(new URLSearchParams(rootRequest.query).get('timestamp'), String(stamp / 1000));
    for (const key of ['KeyM', 'KeyC']) {
      await page.evaluate(() => viewer.element.focus()); await page.keyboard.down(key);
      await page.getByText('Editing can not be performed with a segmentation at an older state.', { exact: true }).first().waitFor();
      assert.equal(await page.evaluate(() => Boolean(viewer.globalToolBinder.activeTool_)), false); await page.keyboard.up(key);
    }
    assert.equal(graphRequests.filter(request => /\/(merge|split)$/.test(request.path)).length, 0);
    return { rootId, rootRequest, writes: 0 };
  });
  await test('graphene-latest-timestamp-query-and-native-tools', async () => {
    await page.evaluate(() => { const layer = viewer.layerManager.getLayerByName('Graph').layer; layer.displayState.segmentationGroupState.value.timestamp.value = undefined; layer.displayState.segmentationGroupState.value.timestampOwner.clear(); });
    await page.waitForFunction(() => viewer.layerManager.getLayerByName('Graph').layer.displayState.segmentationGroupState.value.timestamp.value === undefined);
    const tools = [];
    for (const [key, expected] of [['KeyM', 'grapheneMergeSegments'], ['KeyC', 'grapheneMulticutSegments'], ['KeyF', 'grapheneFindPath']]) {
      await page.evaluate(() => viewer.element.focus()); await page.keyboard.down(key);
      const actual = await page.evaluate(() => viewer.globalToolBinder.activeTool_?.tool.toJSON());
      assert.equal(typeof actual === 'string' ? actual : actual?.type, expected); tools.push(expected);
      await page.keyboard.up(key); await page.evaluate(() => viewer.deactivateTools());
    }
    assert.ok(graphRequests.some(request => request.path.endsWith('/is_latest_roots') && request.query === ''));
    assert.equal(graphRequests.filter(request => /\/(merge|split)$/.test(request.path)).length, 0);
    return { activated: tools, writes: 0 };
  });
  await test('touch-proofreading-controls-use-native-tool-state', async () => {
    await page.evaluate(() => neuroglancerMobile.openPanel('spelunker'));
    await page.locator('[data-spelunker-action="multicut"]').tap();
    assert.equal(await page.evaluate(() => neuroglancerMobile.spelunker.snapshot().active), 'multicut');
    const before = await page.evaluate(() => viewer.layerManager.getLayerByName('Graph').layer.graphConnection.value.state.multicutState.blueGroup.value);
    await page.locator('[data-spelunker-action="swap-group"]').tap();
    assert.equal(await page.evaluate(() => viewer.layerManager.getLayerByName('Graph').layer.graphConnection.value.state.multicutState.blueGroup.value), !before);
    await page.locator('[data-spelunker-action="details"]').tap();
    assert.equal(await page.evaluate(() => neuroglancerMobile.spelunker.snapshot().details), true);
    await page.locator('[data-spelunker-action="clear"]').tap();
    await page.locator('[data-spelunker-action="cancel"]').tap();
    assert.equal(await page.evaluate(() => neuroglancerMobile.spelunker.snapshot().active), null);
    assert.equal(await page.evaluate(() => Boolean(viewer.globalToolBinder.activeTool_)), false);
  });
  await test('touch-proofreading-historical-guards', async () => {
    await restore(graphState()); await page.evaluate(() => neuroglancerMobile.openPanel('spelunker'));
    assert.equal(await page.locator('[data-spelunker-action="merge"]').isDisabled(), true);
    assert.equal(await page.locator('[data-spelunker-action="multicut"]').isDisabled(), true);
    assert.equal(await page.locator('[data-spelunker-action="path"]').isEnabled(), true);
    const rejected = await page.evaluate(() => {
      try { neuroglancerMobile.spelunker.activate('merge', 'Graph'); return false; }
      catch (error) { return error.message.includes('Historical segmentation'); }
    });
    assert.equal(rejected, true); assert.equal(await page.evaluate(() => neuroglancerMobile.spelunker.snapshot().active), null);
    await page.screenshot({ path: resolve(evidence, `${tag}-historical-touch-controls.png`) });
  });
  await test('native-time-request-disposal-and-rejection', async () => {
    for (const removal of ['close-panel', 'remove-layer']) {
      await restore(graphState()); await nativeLayer('Graph', 'graph');
      const time = page.locator('.neuroglancer-time-control input[type="datetime-local"]'); await time.waitFor();
      await page.evaluate(() => {
        const layer = viewer.layerManager.getLayerByName('Graph').layer;
        const graph = layer.graphConnection.value.graph.graphServer;
        window.__timeTest = { group: layer.displayState.segmentationGroupState.value, graph, original: graph.filterLatestRoots };
        graph.filterLatestRoots = () => new Promise(resolve => { window.__timeTest.resolve = resolve; });
      });
      await time.fill('2023-03-01T12:34');
      await page.waitForFunction(() => Boolean(window.__timeTest.resolve));
      if (removal === 'close-panel') {
        await page.evaluate(() => { viewer.selectedLayer.location.visible = false; });
        await time.waitFor({ state: 'hidden' });
      } else {
        await restore(state);
      }
      await page.evaluate(async () => {
        const test = window.__timeTest; test.resolve([]);
        await new Promise(resolve => setTimeout(resolve, 30));
        test.graph.filterLatestRoots = test.original;
      });
      assert.equal(await page.evaluate(() => window.__timeTest.group.timestamp.value), stamp, `${removal} changed historical state after native control disposal`);
    }
    await restore(graphState()); await nativeLayer('Graph', 'graph');
    const time = page.locator('.neuroglancer-time-control input[type="datetime-local"]'); await time.waitFor();
    const before = await time.inputValue();
    await page.evaluate(() => {
      const graph = viewer.layerManager.getLayerByName('Graph').layer.graphConnection.value.graph.graphServer;
      window.__timeTest = { graph, original: graph.filterLatestRoots };
      graph.filterLatestRoots = () => Promise.reject(new Error('Synthetic unavailable time service'));
    });
    await time.fill('2023-03-01T12:34');
    await page.getByText('Unable to change segmentation time:', { exact: false }).waitFor();
    assert.equal(await time.inputValue(), before);
    assert.equal((await current()).layers[0].timestamp, stamp);
    await page.evaluate(() => { window.__timeTest.graph.filterLatestRoots = window.__timeTest.original; });
    return { closePanelRetainedTimestamp: stamp, removedLayerRetainedTimestamp: stamp, rejectedTimeRestored: before };
  });
  await test('disabling-graph-subsource-cancels-mobile-tool', async () => {
    const latest = graphState(); delete latest.layers[0].timestamp; delete latest.layers[0].timestampOwner;
    await restore(latest);
    assert.equal(await page.evaluate(() => neuroglancerMobile.spelunker.activate('multicut', 'Graph')), true);
    await page.evaluate(() => {
      const loaded = viewer.layerManager.getLayerByName('Graph').layer.dataSources[0].loadState;
      loaded.subsources.find(source => source.subsourceEntry.id === 'graph').enabled = false;
      loaded.enabledSubsourcesChanged.dispatch();
    });
    await page.waitForFunction(() => !viewer.layerManager.getLayerByName('Graph').layer.graphConnection.value);
    await page.waitForFunction(() => neuroglancerMobile.spelunker.snapshot().active === null);
    assert.equal(await page.evaluate(() => Boolean(viewer.globalToolBinder.activeTool_)), false);
  });
  await test('historical-range-endpoint-failures-remain-recoverable', async () => {
    for (const table of ['unavailable', 'invalid-time']) {
      const value = graphState(); value.layers[0].source = `graphene://${graphOrigin}/segmentation/table/${table}`;
      await restore(value);
      await page.getByText('Unable to load the historical segmentation time range:', { exact: false }).last().waitFor();
      assert.equal(await page.evaluate(() => viewer.layerManager.getLayerByName('Graph').layer.graphConnection.value.graph.timestampLimit.value), 0);
      assert.equal((await current()).layers[0].timestamp, stamp);
    }
    return { missingEndpointHandled: true, invalidTimestampHandled: true };
  });
  await test('touch-annotation-review-navigates-linked-segments', async () => {
    await restore(); await page.evaluate(() => neuroglancerMobile.openPanel('spelunker'));
    await page.getByLabel('Swap visible segments when moving to annotation', { exact: true }).check();
    await page.locator('[data-spelunker-action="review-start"]').tap();
    await page.locator('[data-spelunker-action="review-next"]').tap();
    assert.deepEqual((await current()).position, [22, 16, 12]);
    let segments = await page.evaluate(() => [...viewer.layerManager.getLayerByName('Segments').layer.displayState.segmentationGroupState.value.visibleSegments].map(String));
    assert.deepEqual(segments, ['1']);
    await page.locator('[data-spelunker-action="review-previous"]').tap();
    assert.deepEqual((await current()).position, [8, 8, 4]);
    segments = await page.evaluate(() => [...viewer.layerManager.getLayerByName('Segments').layer.displayState.segmentationGroupState.value.visibleSegments].map(String));
    assert.deepEqual(segments, ['9007199254740993']);
    return { position: [8, 8, 4], segments };
  });
  await test('native-cave-share-preserves-path-and-state', async () => {
    await restore(); requireTos = false; statePosts = [];
    await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set('share-test', 'retained'); history.replaceState(null, '', url); });
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.evaluate(() => neuroglancerMobile.shareShort());
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('/nglstate/api/v1/42'));
    const link = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(new URL(link).pathname, documentURL.pathname);
    assert.equal(new URL(link).searchParams.get('share-test'), 'retained');
    assert.ok(link.includes('#!middleauth+https://global.daf-apis.com/nglstate/api/v1/42'));
    assert.equal(statePosts.length, 1); assert.equal(statePosts[0].authorization, true);
    assert.equal(statePosts[0].state.layers[0].timestamp, stamp);
    const second = await context.newPage(); await second.goto(link); await ready(second);
    const reopened = await current(second); assert.equal(reopened.layers[0].timestamp, stamp); assert.equal(reopened.layers[1].swapVisbleSegmentsOnMove, false);
    await second.close(); return { link, postedLayers: statePosts[0].state.layers.length, requests: statePosts.length };
  });
  await test('middleauth-missing-terms-popup-and-retry', async () => {
    await open(); requireTos = true; tosAttempts = 0; statePosts = [];
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.evaluate(() => neuroglancerMobile.shareShort());
    await page.getByText('Before you can access Synthetic CAVE dataset, you need to accept its Terms of Service.', { exact: false }).waitFor();
    const popupPromise = context.waitForEvent('page'); await page.getByRole('button', { name: 'Open', exact: true }).click();
    const popup = await popupPromise; await popup.waitForLoadState();
    assert.equal(new URL(popup.url()).searchParams.get('client'), 'ng');
    await popup.getByRole('button', { name: 'Accept synthetic terms', exact: true }).click();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('/nglstate/api/v1/42'));
    assert.equal(statePosts.length, 2); assert.ok(statePosts.every(request => request.authorization));
    requireTos = false; return { requests: statePosts.length, termsAccepted: true };
  });
  await test('runtime-clean', async () => { assert.deepEqual(report.errors, []); return { errors: 0 }; });
} finally {
  report.finishedAt = new Date().toISOString(); report.passed = report.cases.every(result => result.passed);
  report.scriptAssets = await page.locator('script[src]').evaluateAll(elements => elements.map(element => element.src)).catch(() => []);
  report.buildVersion = await context.request.get(new URL('version.json', documentURL).href).then(response => response.json()).catch(() => null);
  report.graphRequests = graphRequests;
  await writeFile(resolve(evidence, `${tag}-browser.json`), `${JSON.stringify(report, null, 2)}\n`);
  await context.close(); await browser.close();
}
if (!report.passed) process.exitCode = 1;
