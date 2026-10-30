// Drives the link converter page in Chromium at phone and desktop sizes.
// BASE_URL points at the served links/index.html (local server or the published page).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from './browser-runtime.mjs';
import { MOBILE_BASE } from '../links/convert.js';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765/links/index.html';
const SHOTS = process.env.EVIDENCE_DIR;
const STATE = '#!%7B%22layers%22:%5B%5D,%22position%22:%5B1,2,3%5D%7D';
const SPELUNKER = `https://spelunker.cave-explorer.org/${STATE}`;
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`ok - ${name}`); };

const browser = await chromium.launch();
try {
  for (const [label, viewport, isMobile] of [['phone', { width: 375, height: 740 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE_URL);

    await check(`${label}: pasting a Spelunker link shows desktop and mobile links`, async () => {
      await page.fill('#input', SPELUNKER);
      assert.equal(await page.isVisible('#results'), true);
      assert.equal(await page.getAttribute('#desktop-open', 'href'), SPELUNKER);
      assert.equal(await page.getAttribute('#mobile-open', 'href'), MOBILE_BASE + STATE);
      assert.equal(await page.textContent('#error'), '');
    });
    await check(`${label}: choosing neuroglancer-demo rewrites the desktop link`, async () => {
      await page.selectOption('#desktop-app', 'neuroglancer-demo');
      assert.equal(await page.getAttribute('#desktop-open', 'href'), `https://neuroglancer-demo.appspot.com/${STATE}`);
      await page.selectOption('#desktop-app', 'auto');
    });
    await check(`${label}: Copy both puts both links on the clipboard`, async () => {
      await page.click('[data-copy="both"]');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `Desktop: ${SPELUNKER}\nMobile: ${MOBILE_BASE}${STATE}`);
      assert.equal(await page.textContent('[data-copy="both"]'), 'Copied');
    });
    await check(`${label}: no horizontal scroll`, async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    });
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/links-${label}.png`, fullPage: true }); }
    await check(`${label}: junk input shows an error and hides results`, async () => {
      await page.fill('#input', 'hello');
      assert.equal(await page.isVisible('#results'), false);
      assert.match(await page.textContent('#error'), /not a URL/);
    });
    await check(`${label}: ?url= prefills, encoded or not`, async () => {
      for (const query of [encodeURIComponent(SPELUNKER), SPELUNKER]) {
        await page.goto(`${BASE_URL}?url=${query}`);
        assert.equal(await page.inputValue('#input'), SPELUNKER);
        assert.equal(await page.getAttribute('#mobile-open', 'href'), MOBILE_BASE + STATE);
      }
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`${checks.length} checks passed`);
