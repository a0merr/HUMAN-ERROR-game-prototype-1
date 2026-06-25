// ============================================================
// HUMAN ERROR — browser smoke test (Playwright)
// Drives solo + multiplayer in headless Chromium, screenshots both, and
// asserts the canvas actually rendered + the player got a role.
//
// Playwright is NOT a project dependency (keeps the game zero-dep). Install it
// once in a throwaway dir and point Node's module resolution at it:
//
//   SD="$TMPDIR/he-pw"; mkdir -p "$SD" && (cd "$SD" && npm i playwright && npx playwright install chromium)
//   PORT=8123 node server.mjs &            # start the app
//   NODE_PATH="$SD/node_modules" PORT=8123 OUT=. node test/browser-smoke.mjs
//
// Env: PORT (default 8123), OUT (screenshot dir, default cwd).
// ============================================================

import { createRequire } from 'node:module';

const PORT = process.env.PORT || 8123;
const BASE = 'http://localhost:' + PORT;
const OUT = process.env.OUT || '.';

// resolve playwright from NODE_PATH / global without making it a dep
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch();
const errors = [];
let failed = false;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); failed = true; } };

async function page() {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  return p;
}
const probeCanvas = (p) => p.evaluate(() => {
  const cv = document.getElementById('game'); const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data; const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 137) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
  return seen.size;
});

// ---- SOLO ----
{
  const p = await page();
  await p.goto(BASE + '/solo', { waitUntil: 'load' });
  await p.waitForSelector('#startBtn', { timeout: 10000 });
  await p.click('#startBtn');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + '/solo-play.png' });
  const colors = await probeCanvas(p);
  const timer = await p.textContent('#timer');
  assert(colors > 30, 'solo canvas should render a rich scene (got ' + colors + ' colors)');
  assert(Number(timer) < 40, 'solo timer should be counting down (got ' + timer + ')');
  console.log('SOLO OK — colors=%d timer=%s', colors, timer);
  await p.context().close();
}

// ---- MULTIPLAYER ----
{
  const p = await page();
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForSelector('#createBtn', { timeout: 10000 });
  await p.fill('#nameInput', 'Smoke');
  await p.click('#createBtn');
  await p.waitForSelector('#lobbyCode', { state: 'visible', timeout: 10000 });
  await p.click('#startBtn');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + '/mp-play.png' });
  const colors = await probeCanvas(p);
  const role = await p.textContent('#role');
  assert(colors > 30, 'mp canvas should render (got ' + colors + ' colors)');
  assert(/HUNTER|HIDER/.test(role), 'mp player should be assigned a role (got "' + role + '")');
  console.log('MP OK — colors=%d role=%s', colors, role);
  await p.context().close();
}

await browser.close();
if (errors.length) { console.error('\nBROWSER ERRORS (' + errors.length + '):'); for (const e of errors) console.error('  ' + e); failed = true; }
console.log(failed ? '\nSMOKE TEST FAILED' : '\nBROWSER SMOKE TEST PASSED');
process.exit(failed ? 1 : 0);
