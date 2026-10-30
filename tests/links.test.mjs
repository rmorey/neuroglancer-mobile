import test from 'node:test';
import assert from 'node:assert/strict';
import { convert, parseLink, MOBILE_BASE } from '../links/convert.js';

const STATE = '#!%7B%22layers%22:%5B%7B%22type%22:%22image%22,%22source%22:%22precomputed://https://c10s.pni.princeton.edu/x%22%7D%5D%7D';

test('desktop links keep their fragment and app, and gain a mobile twin', () => {
  const ng = convert(`https://neuroglancer-demo.appspot.com/${STATE}`);
  assert.equal(ng.desktop, `https://neuroglancer-demo.appspot.com/${STATE}`);
  assert.equal(ng.mobile, `${MOBILE_BASE}${STATE}`);
  assert.equal(ng.sourceApp, 'neuroglancer-demo');
  const sp = convert(`https://spelunker.cave-explorer.org/${STATE}`);
  assert.equal(sp.desktop, `https://spelunker.cave-explorer.org/${STATE}`);
  assert.equal(sp.desktopApp, 'spelunker');
});

test('mobile links go back to Spelunker unless another desktop app is chosen', () => {
  const back = convert(`https://c10s.pni.princeton.edu/web/neuroglancer-mobile/2026-09-13-v2/index.html${STATE}`);
  assert.equal(back.sourceApp, 'mobile');
  assert.equal(back.desktop, `https://spelunker.cave-explorer.org/${STATE}`);
  assert.equal(back.mobile, `${MOBILE_BASE}${STATE}`, 'old mobile releases move to the current one');
  assert.equal(convert(back.mobile, 'neuroglancer-demo').desktop, `https://neuroglancer-demo.appspot.com/${STATE}`);
});

test('the mobile link puts the fragment straight after index.html', () => {
  assert.match(convert(`https://spelunker.cave-explorer.org/${STATE}`).mobile, /\/index\.html#!/);
});

test('CAVE short links keep MiddleAuth, and bare state-server URLs gain it', () => {
  const short = 'https://spelunker.cave-explorer.org/#!middleauth+https://global.daf-apis.com/nglstate/api/v1/5719431830159360';
  assert.equal(convert(short).mobile, `${MOBILE_BASE}#!middleauth+https://global.daf-apis.com/nglstate/api/v1/5719431830159360`);
  for (const bare of ['https://global.daf-apis.com/nglstate/api/v1/57', 'middleauth+https://global.daf-apis.com/nglstate/api/v1/57']) {
    assert.equal(parseLink(bare).fragment, '#!middleauth+https://global.daf-apis.com/nglstate/api/v1/57');
  }
});

test('Slack-wrapped links, bare fragments and raw JSON state are accepted', () => {
  assert.equal(parseLink(`  <https://spelunker.cave-explorer.org/${STATE}|spelunker>\n`).fragment, STATE);
  assert.equal(parseLink(STATE).fragment, STATE);
  const json = convert('{"layers": [], "position": [1, 2, 3]}');
  assert.equal(decodeURIComponent(json.mobile.slice(MOBILE_BASE.length + 2)), '{"layers":[],"position":[1,2,3]}');
});

test('other Neuroglancer hosts convert, and links without state still open the apps', () => {
  const other = convert(`https://ngl.cave-explorer.org/${STATE}`);
  assert.equal(other.sourceApp, 'other');
  assert.equal(other.desktop, `https://spelunker.cave-explorer.org/${STATE}`);
  const empty = convert('https://spelunker.cave-explorer.org/');
  assert.equal(empty.mobile, MOBILE_BASE);
  assert.equal(empty.hasState, false);
});

test('junk input is rejected with a readable message', () => {
  for (const bad of ['', '   ', 'hello', '{not json', 'ftp://example.org/#!{}']) assert.throws(() => convert(bad), /./);
  assert.throws(() => convert(`https://spelunker.cave-explorer.org/${STATE}`, 'nope'), /Unknown desktop app/);
});
