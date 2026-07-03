// ============================================================
// HUMAN ERROR — mobile/touch smoke (Playwright, throwaway test)
// Emulates a touch phone in landscape and asserts the mobile funnel works:
//   - canvas is CSS-scaled to fit the viewport (responsive, not 960px overflow)
//   - on-screen touch controls (#touchUI) build + toggle on during play
//   - the virtual joystick actually moves the player
//   - mp deep-link (?room=CODE) auto-joins with no typing
// Run identically to browser-smoke.mjs (NODE_PATH -> playwright, PORT, OUT).
// ============================================================

import { createRequire } from 'node:module';

const PORT = process.env.PORT || 8123;
const BASE = 'http://localhost:' + PORT;
const OUT = process.env.OUT || '.';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const browser = await chromium.launch();
const errors = [];
let failed = false;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); failed = true; } };

// landscape touch phone
async function phone() {
  const ctx = await browser.newContext({
    viewport: { width: 740, height: 360 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  // spy on outbound WebSocket traffic so we can assert what the client sent
  await p.addInitScript(() => {
    window.__sent = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { try { window.__sent.push(String(d)); } catch (e) {} return orig.call(this, d); };
  });
  p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  return p;
}

// ---- SOLO touch ----
{
  const p = await phone();
  await p.addInitScript(() => { try { localStorage.setItem('humanError.taught', '1'); } catch (e) {} });
  await p.goto(BASE + '/solo', { waitUntil: 'load' });
  await p.waitForSelector('#startBtn', { timeout: 10000 });
  await p.click('#startBtn');
  await p.waitForTimeout(800);

  // canvas must be CSS-scaled to fit (<= viewport), not its native 960px
  const fit = await p.evaluate(() => {
    const cv = document.getElementById('game');
    return { cssW: cv.getBoundingClientRect().width, vw: window.innerWidth };
  });
  assert(fit.cssW <= fit.vw + 1, 'solo canvas should fit viewport (css ' + fit.cssW.toFixed(0) + ' vs vw ' + fit.vw + ')');
  assert(fit.cssW < 900, 'solo canvas should be scaled down on phone (got ' + fit.cssW.toFixed(0) + ')');

  // touch UI built + on during play
  const uiOn = await p.evaluate(() => document.getElementById('touchUI')?.classList.contains('on'));
  assert(uiOn === true, 'solo #touchUI should be visible during play');

  // drive the joystick: drag from left-zone center, hold, sample player movement
  const before = await p.evaluate(() => 1); // placeholder to keep ordering
  const zone = await p.evaluate(() => {
    const z = document.querySelector('.tc-stickZone').getBoundingClientRect();
    return { x: z.left + z.width / 2, y: z.top + z.height / 2 };
  });
  // capture canvas hash, push stick right for ~700ms, capture again — scene must change
  const hashAt = () => p.evaluate(() => {
    const cv = document.getElementById('game'); const g = cv.getContext('2d');
    const d = g.getImageData(0, cv.height / 2 | 0, cv.width, 1).data; let h = 0;
    for (let i = 0; i < d.length; i += 8) h = (h * 31 + d[i]) >>> 0;
    return h;
  });
  const h0 = await hashAt();
  await p.touchscreen.tap(zone.x, zone.y); // wake
  // synthesize a held drag to the right via pointer events on the zone
  await p.evaluate(({ x, y }) => {
    const z = document.querySelector('.tc-stickZone');
    const pd = (type, cx) => z.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: cx, clientY: y, bubbles: true }));
    pd('pointerdown', x);
    window.__held = setInterval(() => pd('pointermove', x + 90), 16);
  }, zone);
  await p.waitForTimeout(700);
  const h1 = await hashAt();
  await p.evaluate(() => { clearInterval(window.__held); document.querySelector('.tc-stickZone').dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })); });
  assert(h0 !== h1, 'joystick drag should move the scene (hashes equal = no movement)');

  await p.screenshot({ path: OUT + '/mobile-solo.png' });
  console.log('SOLO TOUCH OK — cssW=%d uiOn=%s moved=%s', fit.cssW | 0, uiOn, h0 !== h1);
  await p.context().close();
}

// ---- MP deep-link ----
{
  // first create a room on desktop-ish context to get a real code
  const host = await phone();
  await host.goto(BASE + '/', { waitUntil: 'load' });
  await host.fill('#nameInput', 'Host');
  await host.click('#createBtn');
  await host.waitForSelector('#lobbyCode', { state: 'visible', timeout: 10000 });
  const code = (await host.textContent('#lobbyCode')).trim();
  assert(/^[A-Z0-9]{2,}$/.test(code), 'should get a room code (got "' + code + '")');

  // invite link must be the deep-link a guest can tap
  const shareUrl = (await host.textContent('#shareUrl')).trim();
  assert(shareUrl.endsWith('/?room=' + code), 'invite link should be deep-link for ' + code + ' (got ' + shareUrl + ')');

  // a second phone hits ?room=CODE and should auto-land in the lobby with no typing
  const guest = await phone();
  await guest.goto(BASE + '/?room=' + code, { waitUntil: 'load' });
  await guest.waitForSelector('#lobbyScreen:not(.hidden)', { timeout: 10000 });
  const joinedCode = (await guest.textContent('#lobbyCode')).trim();
  assert(joinedCode === code, 'deep-link guest should be in room ' + code + ' (got ' + joinedCode + ')');
  console.log('MP DEEP-LINK OK — room=%s autojoined', code);

  // ---- hunter tap-to-tag ----
  // start the 2-player match; one page becomes the hunter. Tap directly on the
  // nearest body and assert an immediate tag input (with aim) went to the wire.
  await host.click('#startBtn');
  const isHunter = (p) => p.evaluate(() => window.__he && window.__he.role() === 'hunter' && window.__he.bodies().length > 0);
  let hunter = null;
  for (let i = 0; i < 50 && !hunter; i++) {
    if (await isHunter(host)) hunter = host;
    else if (await isHunter(guest)) hunter = guest;
    else await host.waitForTimeout(200);
  }
  assert(!!hunter, 'one of the two phones should become the hunter');
  if (hunter) {
    const tap = await hunter.evaluate(() => {
      const bs = window.__he.bodies(); const me = bs.find(b => b.id === window.__he.myId());
      const t = bs.filter(b => b.id !== me.id)
        .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      const r = document.getElementById('game').getBoundingClientRect();
      window.__sent.length = 0;   // only count traffic caused by the tap
      return { cx: r.left + t.x / 960 * r.width, cy: r.top + t.y / 600 * r.height };
    });
    await hunter.evaluate(({ cx, cy }) => {
      document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: cx, clientY: cy, bubbles: true }));
    }, tap);
    const countTags = () => hunter.evaluate(() => window.__sent.filter(s => {
      try { const m = JSON.parse(s); return m.t === 'input' && m.tag === true; } catch (e) { return false; }
    }).length);
    const tagSent = await hunter.evaluate(() => window.__sent.some(s => {
      try { const m = JSON.parse(s); return m.t === 'input' && m.tag === true && typeof m.aim === 'number'; } catch (e) { return false; }
    }));
    assert(tagSent, 'hunter tap on a body should send an immediate tag input with aim');
    // instant-path spam guard: a rapid second tap inside the 250ms client
    // cooldown must not produce a second tag message
    await hunter.evaluate(({ cx, cy }) => {
      document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, clientX: cx, clientY: cy, bubbles: true }));
    }, tap);
    const tags = await countTags();
    assert(tags === 1, 'rapid double-tap should send exactly 1 tag (got ' + tags + ')');
    console.log('TAP-TO-TAG OK — tagSent=%s spamGuard=%s', tagSent, tags === 1);
  }

  await guest.context().close();
  await host.context().close();
}

await browser.close();
if (errors.length) { console.error('\nBROWSER ERRORS (' + errors.length + '):'); for (const e of errors) console.error('  ' + e); failed = true; }
console.log(failed ? '\nMOBILE SMOKE FAILED' : '\nMOBILE SMOKE PASSED');
process.exit(failed ? 1 : 0);
