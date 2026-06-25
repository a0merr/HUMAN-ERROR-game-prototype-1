// ============================================================
// HUMAN ERROR — SOLO entry (wave roguelite)
// The solo rules layer: waves, perks, suspicion, decoys, kill-cam, scoring.
// All crowd/hunter/glitch behavior comes from the shared engine.
// ============================================================

import { ARENA, WAVE, MAPS, ALL_PERKS, PALETTE } from '../engine/config.mjs';
import { clamp } from '../engine/math.mjs';
import { CrowdSim } from '../engine/sim.mjs';
import { makeHunter, updateHunter, seesAgent, maxPlayerLock } from '../engine/hunter.mjs';
import { humanScore } from '../engine/agents.mjs';
import { Renderer, Particles } from './render.mjs';
import { Input } from './input.mjs';
import { Hud } from './hud.mjs';
import { initAudio, beep, sfx } from './audio.mjs';

const cv = document.getElementById('game');
const renderer = new Renderer(cv);
const particles = new Particles();
const hud = new Hud();
const input = new Input().attach();

let sim = null, player = null;
let wave = 1, waveTime = 0, running = false, betweenWaves = false;
let suspicion = 0, shake = 0;
let totalTime = 0, score = 0, decoyCD = 0, heartT = 0, lastTimerInt = 0;
let killcam = null, pendingEnd = null;
let perks = new Set();
let stats = { botsOut: 0, glitchHit: 0, glitchTotal: 0 };
let best = parseInt(localStorage.getItem('humanError.best') || '0', 10) || 0;

const hasPerk = (id) => perks.has(id);
const huntersForWave = (w) => clamp(1 + Math.floor((w - 1) / 2), 1, WAVE.maxHunters);
const lockSpeed = () => 0.78 + wave * 0.05;

// ---- wave lifecycle ----
function startGame() {
  wave = 1; totalTime = 0; score = 0; perks = new Set(); decoyCD = 0;
  stats = { botsOut: 0, glitchHit: 0, glitchTotal: 0 };
  beginWave();
}

function beginWave() {
  const map = MAPS[(wave - 1) % MAPS.length];
  sim = new CrowdSim({ seed: (Date.now() ^ (wave * 2654435761)) >>> 0, mapId: map.id, npcCount: WAVE.npcCount, botCount: WAVE.botCount });
  sim.lockSpeed = lockSpeed();
  sim.buildCrowd();
  player = sim.addHuman({ role: 'hider', x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h - 55 });
  sim.player = player;
  const n = huntersForWave(wave);
  sim.hunters = [];
  for (let i = 0; i < n; i++) sim.hunters.push(makeHunter(i, n, sim.rng, wave));

  waveTime = WAVE.secs; suspicion = 0; running = true; betweenWaves = false;
  shake = 0; killcam = null; pendingEnd = null;
  lastTimerInt = Math.ceil(waveTime);
  hud.hideGlitch();
  hud.setWave('WAVE ' + wave);
  hud.setTimerLabel('SURVIVE · ' + n + (n > 1 ? ' HUNTERS' : ' HUNTER'));
}

function clearWave() {
  running = false; betweenWaves = true; score += 100;
  let pool = ALL_PERKS.filter(p => !perks.has(p.id));
  if (pool.length < 3) pool = ALL_PERKS.slice();
  pool = pool.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  hud.showPerks(wave, pool, choosePerk);
  sfx.clear();
}

function choosePerk(id) {
  perks.add(id); hud.hidePerks(); wave++; beginWave();
}

// ---- input actions ----
input.on('enter', () => {
  if (!hud.startScreen.classList.contains('hidden')) start();
  else if (!hud.endScreen.classList.contains('hidden')) start();
});
input.on('react', () => {
  if (!running || !sim.glitch || player.reacted) return;
  player.reacted = true; player.reacting = true; player.reactT = Math.max(0.2, sim.glitch.t);
  if (sim.glitch.t > sim.glitch.t0 - sim.glitch.window) stats.glitchHit++;
  sfx.react();
});
input.on('decoy', tryDecoy);
input.on('screenshot', () => {
  try { const a = document.createElement('a'); a.download = 'human-error-' + Date.now() + '.png'; a.href = cv.toDataURL('image/png'); a.click(); } catch (e) {}
});

function tryDecoy() {
  if (!running || !hasPerk('decoy') || decoyCD > 0 || !player) return;
  sim.decoys.push({ x: player.x, y: player.y, t: 4, isDecoy: true });
  decoyCD = 12; sfx.decoy(); shake = Math.max(shake, 5); hud.feed('Decoy dropped');
}

// ---- suspicion ----
function anyHunterSeesPlayer() {
  for (const h of sim.hunters) if (seesAgent(h, player, sim.pillars)) return true;
  return false;
}
function updateSuspicion(dt) {
  const moving = Math.hypot(player.vx, player.vy) > 4;
  const ghosting = hasPerk('ghost') && input.keys['shift'];
  const seen = !ghosting && anyHunterSeesPlayer();
  let rate = 0;
  if (seen) {
    rate += humanScore(player, sim);
    if (hasPerk('mimic') && !moving) rate *= 0.5;  // auto-blend pose
    rate += 5;
  }
  let cool = -13 * (hasPerk('decay') ? 1.7 : 1);
  if (hasPerk('still') && !moving) cool *= 2;
  if (rate < 4) rate = cool;
  if (hasPerk('calm') && rate > 0) rate *= 0.7;
  suspicion = clamp(suspicion + rate * dt, 0, 100);
  if (suspicion >= 100 && running) endGame('suspicion');
}

// ---- events from sim ----
function resolveEvents() {
  for (const e of sim.events) {
    if (e.type === 'catchPlayer') { endGame('caught'); return; }
    if (e.type === 'popBot') {
      const b = e.agent;
      if (b.alive === false) continue;
      particles.burst(b.x, b.y, PALETTE.pink, 22);
      sim.removeAgent(b);
      stats.botsOut++; score += 10; shake = Math.max(shake, 8);
      hud.feed('A human was caught!'); sfx.bot();
    } else if (e.type === 'popDecoy') {
      const d = e.decoy; const i = sim.decoys.indexOf(d); if (i >= 0) sim.decoys.splice(i, 1);
      e.hunter.target = null; particles.burst(d.x, d.y, PALETTE.blue, 12);
    }
  }
}

// ---- end / kill-cam ----
function endGame(reason) {
  if (!running) return;
  running = false;
  for (const h of sim.hunters) h.lock = 0;
  hud.setVignette(0);
  pendingEnd = { reason };
  killcam = { x: player.x, y: player.y, t: 0, dur: 2.4, label: 'CAUGHT — too human.' };
  particles.burst(player.x, player.y, PALETTE.pink, 40); shake = 18;
  sfx.catch();
}
function showEndScreen() {
  if (!pendingEnd) return;
  const reason = pendingEnd.reason; killcam = null;
  score += Math.floor(totalTime);
  const isBest = score > best;
  if (isBest) { best = score; localStorage.setItem('humanError.best', String(best)); }
  hud.showEnd({
    title: 'CAUGHT', win: false,
    sub: (reason === 'suspicion' ? 'Suspicion maxed on wave ' : 'Hunter locked you on wave ') + wave + '.',
    statsHtml:
      `<span><b>${wave - 1}</b>waves cleared</span>` +
      `<span><b>${score}</b>score${isBest ? ' ★' : ''}</span>` +
      `<span><b>${best}</b>best</span>` +
      `<span><b>${stats.botsOut}</b>bots busted</span>`,
    flavor: 'Every caught human is a punchline. Grab a perk, blend harder, push the wave count.',
  });
  pendingEnd = null;
}

// ---- main loop ----
let last = 0;
function frame(ts) {
  try { tick(ts); } catch (err) { console.error('HUMAN ERROR loop fault:', err); }
  requestAnimationFrame(frame);
}
function tick(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;

  if (running) {
    waveTime -= dt; totalTime += dt;
    if (decoyCD > 0) decoyCD = Math.max(0, decoyCD - dt);
    const ti = Math.ceil(waveTime);
    if (ti !== lastTimerInt && ti >= 0) {
      lastTimerInt = ti; hud.setTimer(ti);
      if (ti <= 10 && ti > 0) sfx.tickLow(ti);
    }
    if (waveTime <= 0) { waveTime = 0; clearWave(); }
    else {
      sim.events.length = 0;
      const g = sim.stepGlitch(dt);
      if (g) { hud.showGlitch(g); sfx.glitch(); shake = Math.max(shake, 7); stats.glitchTotal++; }
      if (!sim.glitch) hud.hideGlitch();

      const intent = input.intent({ sprintPerk: hasPerk('sprint') });
      sim.applyHumanIntent(player, dt, intent);
      sim.stepCrowd(dt);
      for (const h of sim.hunters) { updateHunter(h, dt, sim); if (!running) break; }
      resolveEvents();
      if (running) updateSuspicion(dt);

      hud.setSuspicion(suspicion);
      const heat = Math.max(suspicion / 100 * 0.6, maxPlayerLock(sim.hunters, player));
      hud.setVignette(heat * 0.9);
      if (heat > 0.4) { heartT -= dt; if (heartT <= 0) { heartT = clamp(0.7 - heat * 0.4, 0.18, 0.7); sfx.heart(heat); } }
    }
  }

  if (killcam) { killcam.t += dt * 0.45; if (killcam.t >= killcam.dur) showEndScreen(); }
  particles.step(dt);
  shake *= 0.86;
  hud.stepFeed(dt);

  if (sim) renderer.render(sim, { player, perks, killcam, shake, particles: particles.list, labelPlayer: true, maxLock: maxPlayerLock(sim.hunters, player) });
}

// ---- boot ----
function start() {
  initAudio();
  hud.hideOverlays();
  startGame();
}
document.getElementById('startBtn').addEventListener('click', start);
document.getElementById('againBtn').addEventListener('click', start);
requestAnimationFrame(frame);
