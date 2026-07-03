// ============================================================
// HUMAN ERROR — SOLO entry (wave roguelite)
// The solo rules layer: waves, perks, suspicion, decoys, kill-cam, scoring.
// All crowd/hunter/glitch behavior comes from the shared engine.
// ============================================================

import { ARENA, WAVE, MAPS, ALL_PERKS, PALETTE, KILLCAM_TEXT } from '../engine/config.mjs';
import { clamp } from '../engine/math.mjs';
import { CrowdSim } from '../engine/sim.mjs';
import { makeHunter, updateHunter, seesAgent, maxPlayerLock } from '../engine/hunter.mjs';
import { humanScore, neighborStats } from '../engine/agents.mjs';
import { collidePillars } from '../engine/geometry.mjs';
import { Renderer, Particles } from './render.mjs';
import { Input } from './input.mjs';
import { Hud, presentClip } from './hud.mjs';
import { initAudio, beep, sfx, getRecordStream, setMuted, isMuted } from './audio.mjs';
import { setHighVisTells, getHighVisTells } from './render.mjs';
import { ClipRecorder } from './clip.mjs';
import { fitCanvas } from './viewport.mjs';
import { makeTouchControls } from './touch.mjs';
import { ReplayRecorder, ReplayPlayer } from '../engine/replay.mjs';
import { save as platformSave } from './platform.mjs';

const cv = document.getElementById('game');
const renderer = new Renderer(cv);
const particles = new Particles();
const hud = new Hud();
const input = new Input().attach();
const clip = new ClipRecorder(cv, { gameName: 'human-error', getAudioStream: getRecordStream, onSave: presentClip });
fitCanvas(cv);
const touch = makeTouchControls({
  onMove: (ix, iy) => input.setMove(ix, iy),
  actions: [
    { label: '🎬', onDown: () => input.trigger('clip') },
    { label: 'Q', onDown: () => input.trigger('decoy') },
    { label: 'REACT', onDown: () => input.trigger('react') },
    { label: 'DANCE', hold: true, onDown: () => input.setDance(true), onUp: () => input.setDance(false) },
    { label: 'BLEND', hold: true, onDown: () => input.setSlow(true), onUp: () => input.setSlow(false) },
  ],
});

// Fixed-step simulation (60 Hz). Determinism is load-bearing: the replay
// system re-simulates from recorded inputs, so the live sim must advance in
// exact 1/60 steps too (rendering stays per-rAF).
const STEP = 1 / 60;
let rec = null, recTick = 0;   // replay recorder for the current wave

let sim = null, player = null;
let wave = 1, waveTime = 0, running = false, betweenWaves = false;
let suspicion = 0, shake = 0;
let totalTime = 0, score = 0, decoyCD = 0, heartT = 0, lastTimerInt = 0;
let killcam = null, pendingEnd = null;
let perks = new Set();
let stats = { botsOut: 0, glitchHit: 0, glitchTotal: 0 };
let best = parseInt(localStorage.getItem('humanError.best') || '0', 10) || 0;
// scoring combo + perk timers
let combo = 0, comboT = 0, maxCombo = 0;
let adrenT = 0, slipGrace = 0, wasSeen = false;
let tellCD = 0, prevSlipNear = 0, dustCD = 0;
let fxFlash = 0, fxDanger = 0;   // surveillance post-FX: chroma punch + edge-tint heat
const camCode = (s) => { s = Math.max(0, s | 0); const m = (s / 60) | 0, r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; };

// lifetime meta-progression (persisted across runs)
const META_DEFAULTS = { runs: 0, waves: 0, bots: 0, glitchHits: 0, lifeScore: 0, bestWave: 0, bestScore: 0 };
function loadMeta() {
  try { return Object.assign({}, META_DEFAULTS, JSON.parse(localStorage.getItem('humanError.meta') || '{}')); }
  catch (e) { return { ...META_DEFAULTS }; }
}
let meta = loadMeta();
const RANKS = [
  [0, 'ROOKIE BLENDER'], [600, 'STREET EXTRA'], [2000, 'CROWD REGULAR'],
  [5000, 'CONVINCING FAKE'], [12000, 'PERFECT MIMIC'], [30000, 'GHOST IN THE CROWD'],
];
function rankFor(s) { let r = RANKS[0][1]; for (const [t, n] of RANKS) if (s >= t) r = n; return r; }
function metaHtml() {
  return `Rank: <b>${rankFor(meta.lifeScore)}</b> · best wave <b>${meta.bestWave}</b> · ` +
    `best score <b>${meta.bestScore}</b> · <b>${meta.bots}</b> humans busted all-time`;
}

const hasPerk = (id) => perks.has(id);
const huntersForWave = (w) => clamp(1 + Math.floor((w - 1) / 2), 1, WAVE.maxHunters);
const lockSpeed = () => 0.78 + wave * 0.05;

// ---- wave lifecycle ----
function startGame() {
  wave = 1; totalTime = 0; score = 0; perks = new Set(); decoyCD = 0;
  combo = 0; comboT = 0; maxCombo = 0; adrenT = 0; slipGrace = 0; wasSeen = false;
  stats = { botsOut: 0, glitchHit: 0, glitchTotal: 0 };
  beginWave();
}

function beginWave() {
  const map = MAPS[(wave - 1) % MAPS.length];
  const seed = (Date.now() ^ (wave * 2654435761)) >>> 0;
  const spawn = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h - 55 };
  sim = new CrowdSim({ seed, mapId: map.id, npcCount: WAVE.npcCount, botCount: WAVE.botCount });
  sim.lockSpeed = lockSpeed();
  sim.buildCrowd();
  player = sim.addHuman({ role: 'hider', x: spawn.x, y: spawn.y });
  sim.player = player;
  const n = huntersForWave(wave);
  sim.hunters = [];
  for (let i = 0; i < n; i++) sim.hunters.push(makeHunter(i, n, sim.rng, wave));

  // record this wave — becomes humanError.lastReplay if it ends in a death
  rec = new ReplayRecorder(); recTick = 0;
  rec.begin({
    mode: 'solo', seed, mapId: map.id, npcCount: WAVE.npcCount, botCount: WAVE.botCount, dt: STEP,
    solo: { wave, hunters: n, lockSpeed: lockSpeed(), spawn },
  });

  waveTime = WAVE.secs; suspicion = 0; running = true; betweenWaves = false;
  shake = 0; killcam = null; pendingEnd = null;
  lastTimerInt = Math.ceil(waveTime);
  hud.hideGlitch();
  hud.setWave('WAVE ' + wave);
  hud.setTimerLabel('SURVIVE · ' + n + (n > 1 ? ' HUNTERS' : ' HUNTER'));
  touch.show();
}

function clearWave() {
  running = false; betweenWaves = true; score += 100;
  rec = null;   // survived — only deaths are worth replaying
  touch.hide();
  if (hasPerk('veteran')) { score += 60; hud.feed('Veteran bonus +60'); }
  combo = 0; comboT = 0; hud.setCombo(0);
  let pool = ALL_PERKS.filter(p => !perks.has(p.id));
  if (pool.length < 3) pool = ALL_PERKS.slice();
  pool = pool.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  hud.showPerks(wave, pool, choosePerk);
  sfx.clear();
}

function choosePerk(id) {
  perks.add(id); hud.hidePerks(); wave++; beginWave();
}

// ---- onboarding / teaching round (the 30-second "I get it" moment) ----
let tutorial = null;
const TUT_STEPS = [
  { title: '● REC · CAM-00 · BEHAVIORAL SCAN',
    text: 'That ringed body is <b>YOU</b> — the only real human on this feed. Move with <b>WASD / Arrows</b>.',
    done: (t) => t.moved > 140 },
  { title: 'BLEND PROTOCOL',
    text: 'Hold <b>SHIFT</b> to walk slow like the NPCs. Moving like them is how you disappear.',
    done: (t) => t.shiftT > 1.2 },
  { title: 'THE TELL',
    text: 'A fake human just glitched — see the <b>💨</b>? They act <b>too human</b>. That’s exactly what gets flagged.',
    enter: forceTutorialSlip, done: (t) => t.stepT > 4 },
  { title: 'THE HUNTER',
    text: 'It scans the crowd and locks whoever looks <b>most human</b>. Don’t be that body — blend until it gives up.',
    enter: addTutorialHunter, done: (t) => t.stepT > 6 },
  { title: 'CLEARED FOR DUTY',
    text: 'You’ve got it. Dropping you into the real shift…',
    done: (t) => t.stepT > 1.8 },
];

function startTutorial() {
  const map = MAPS[0];
  sim = new CrowdSim({ seed: (Date.now() >>> 0) || 1, mapId: map.id, npcCount: WAVE.npcCount, botCount: WAVE.botCount });
  sim.lockSpeed = 0.5;   // gentle: the training Hunter is slow to commit
  sim.buildCrowd();
  player = sim.addHuman({ role: 'hider', x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h - 55 });
  sim.player = player; sim.hunters = [];
  running = false; betweenWaves = false; killcam = null; pendingEnd = null;
  wave = 0; totalTime = 0; score = 0; perks = new Set();
  suspicion = 0; shake = 0; fxFlash = 0; fxDanger = 0; combo = 0; hud.setCombo(0);
  tutorial = { step: 0, t: 0, stepT: 0, moved: 0, shiftT: 0, px: player.x, py: player.y };
  hud.setWave('TRAINING'); hud.setTimerLabel('CAM-00'); hud.setTimer('—'); hud.setSuspicion(0); hud.hideGlitch();
  touch.show();
  enterTutStep();
}
function enterTutStep() {
  const s = TUT_STEPS[tutorial.step];
  hud.showCoach(s.title, s.text);
  if (s.enter) s.enter();
}
function advanceTut() {
  tutorial.step++; tutorial.stepT = 0;
  if (tutorial.step >= TUT_STEPS.length) { finishTutorial(); return; }
  enterTutStep();
}
function finishTutorial() {
  tutorial = null; hud.hideCoach();
  try { localStorage.setItem('humanError.taught', '1'); } catch (e) {}
  startGame();
}
function forceTutorialSlip() {
  let best = null, bd = 1e9;
  for (const a of sim.agents) {
    if (!a.botHider) continue;
    const d = (a.x - player.x) ** 2 + (a.y - player.y) ** 2;
    if (d < bd) { bd = d; best = a; }
  }
  if (best) { best.slipping = true; best.slip = 'sprint'; best.slipDur = 3.4; best.slipT = 99; sfx.tell(); }
}
function addTutorialHunter() {
  sim.hunters = [makeHunter(0, 1, sim.rng, 1)]; sfx.scan();
}

function stepTutorial(dt, ts) {
  const tut = tutorial; tut.t += dt; tut.stepT += dt;
  sim.events.length = 0;
  sim.applyHumanIntent(player, dt, input.intent({}));
  sim.stepCrowd(dt);
  for (const h of sim.hunters) updateHunter(h, dt, sim);
  for (const e of sim.events) {
    if (e.type === 'popBot') { particles.burst(e.agent.x, e.agent.y, PALETTE.pink, 18); sim.removeAgent(e.agent); sfx.bot(); }
    // catchPlayer / catchHider ignored — training is consequence-free
  }
  const dx = player.x - tut.px, dy = player.y - tut.py;
  tut.moved += Math.hypot(dx, dy); tut.px = player.x; tut.py = player.y;
  if (input.keys['shift']) tut.shiftT += dt;
  let danger = 0;
  for (const h of sim.hunters) if (seesAgent(h, player, sim.pillars)) danger = Math.max(danger, h.lock);
  fxDanger = danger;
  if (TUT_STEPS[tut.step].done(tut)) advanceTut();
  particles.step(dt); shake *= 0.86; fxFlash = Math.max(0, fxFlash - dt * 1.6);
  renderer.render(sim, {
    player, perks: new Set(), killcam: null, shake, particles: particles.list,
    labelPlayer: true, maxLock: maxPlayerLock(sim.hunters, player),
    surveil: { time: ts / 1000, cam: 'CAM-00', code: camCode(tut.t), flash: fxFlash, danger: fxDanger },
  });
}

// ---- input actions ----
input.on('enter', () => {
  if (tutorial) { finishTutorial(); return; }   // skip training
  if (!hud.startScreen.classList.contains('hidden')) start();
  else if (!hud.endScreen.classList.contains('hidden')) start();
});
input.on('react', () => {
  if (!running || !sim.glitch || player.reacted) return;
  player.reacted = true; player.reacting = true; player.reactT = Math.max(0.2, sim.glitch.t);
  if (rec) rec.event(recTick, { k: 'react', rt: player.reactT });
  if (sim.glitch.t > sim.glitch.t0 - sim.glitch.window) stats.glitchHit++;
  sfx.react();
});
input.on('decoy', tryAbility);
input.on('screenshot', () => {
  try {
    cv.toBlob(async (blob) => {
      if (!blob) return;
      const path = await platformSave(blob, 'human-error-' + Date.now() + '.png', 'picture');
      hud.feed(path ? '📸 Saved: ' + path : '📸 Screenshot saved');
    }, 'image/png');
  } catch (e) {}
});
input.on('clip', () => { if (clip.capture('clip')) { hud.feed('🎬 Clip saved'); sfx.shutter(); } });

// ---- settings corner: mute (M) + high-visibility tells ----
const muteBtn = document.getElementById('muteBtn');
const tellsBtn = document.getElementById('tellsBtn');
function renderSettings() {
  if (muteBtn) { muteBtn.textContent = isMuted() ? '🔇' : '🔊'; muteBtn.classList.toggle('on', isMuted()); }
  if (tellsBtn) { tellsBtn.textContent = getHighVisTells() ? '◉' : '◎'; tellsBtn.classList.toggle('on', getHighVisTells()); }
}
function toggleMute() { setMuted(!isMuted()); renderSettings(); }
if (muteBtn) muteBtn.addEventListener('click', toggleMute);
if (tellsBtn) tellsBtn.addEventListener('click', () => { setHighVisTells(!getHighVisTells()); renderSettings(); });
addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'm' && !e.repeat) toggleMute(); });
renderSettings();

// Q-slot ability — decoy drop or blink dash, whichever perk is held.
function tryAbility() {
  if (!running || !player || decoyCD > 0) return;
  if (hasPerk('decoy')) {
    const life = hasPerk('magnet') ? 7 : 4;
    sim.decoys.push({ x: player.x, y: player.y, t: life, isDecoy: true, strong: hasPerk('magnet') });
    if (rec) rec.event(recTick, { k: 'decoy', d: [player.x, player.y, life, hasPerk('magnet') ? 1 : 0] });
    decoyCD = 12; sfx.decoy(); shake = Math.max(shake, 5); hud.feed('Decoy dropped');
  } else if (hasPerk('blink')) {
    const a = player.facing, hop = 84;
    player.x = clamp(player.x + Math.cos(a) * hop, ARENA.x + 12, ARENA.x + ARENA.w - 12);
    player.y = clamp(player.y + Math.sin(a) * hop, ARENA.y + 12, ARENA.y + ARENA.h - 12);
    collidePillars(player, sim.pillars);
    if (rec) rec.event(recTick, { k: 'blink', p: [player.x, player.y] });
    decoyCD = 7; sfx.decoy(); shake = Math.max(shake, 4); particles.burst(player.x, player.y, PALETTE.blue, 14); hud.feed('Blink!');
  }
}

// ---- suspicion ----
function anyHunterSeesPlayer() {
  for (const h of sim.hunters) if (seesAgent(h, player, sim.pillars)) return true;
  return false;
}
function updateSuspicion(dt) {
  const moving = Math.hypot(player.vx, player.vy) > 4;
  const slow = !!input.keys['shift'];
  const ghosting = hasPerk('ghost') && slow;
  let seen = !ghosting && anyHunterSeesPlayer();
  // slippery: short grace the moment a Hunter first picks you up
  if (seen && !wasSeen) { sfx.scan(); if (hasPerk('slip')) slipGrace = 0.6; }   // sonar ping the moment you're acquired
  wasSeen = seen;
  if (slipGrace > 0) { slipGrace = Math.max(0, slipGrace - dt); if (seen) seen = false; }

  let rate = 0;
  if (seen) {
    rate += humanScore(player, sim);
    // hiding in a crowd knot muddies the read — the core fantasy. Everyone gets
    // a small blend bonus; Low Profile deepens it.
    if (neighborStats(player, 90, sim.agents).n >= 3) rate *= hasPerk('lowpro') ? 0.5 : 0.85;
    // mimic (and doppel extends it to slow-walking) auto-blends your pose
    const blending = hasPerk('mimic') && (!moving || (hasPerk('doppel') && slow));
    if (blending) rate *= 0.5;
    rate += 5;
  }
  let cool = -13 * (hasPerk('decay') ? 1.7 : 1);
  if (hasPerk('still') && !moving) cool *= 2;
  if (adrenT > 0) { adrenT = Math.max(0, adrenT - dt); cool *= 2; }   // post-glitch surge
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
      // style combo: each bot busted inside the window stacks a multiplier
      combo++; comboT = 5; maxCombo = Math.max(maxCombo, combo);
      const mult = 1 + Math.min(combo - 1, 8) * 0.25;   // up to ×3
      stats.botsOut++; score += Math.round(10 * mult); shake = Math.max(shake, 8);
      hud.setCombo(combo);
      hud.feed(combo >= 2 ? `Human caught! ×${combo}` : 'A human was caught!'); sfx.bot();
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
  // stash the death for /solo?replay=1 (cap ~200 KB so localStorage stays sane)
  if (rec) {
    try {
      const json = JSON.stringify(rec.end({ reason, wave, score }));
      if (json.length <= 200_000) localStorage.setItem('humanError.lastReplay', json);
    } catch (e) {}
    rec = null;
  }
  touch.hide();
  for (const h of sim.hunters) h.lock = 0;
  hud.setVignette(0);
  pendingEnd = { reason };
  killcam = { x: player.x, y: player.y, t: 0, dur: 2.4, label: KILLCAM_TEXT };
  particles.burst(player.x, player.y, PALETTE.pink, 58);
  particles.burst(player.x, player.y, PALETTE.ink, 18);
  shake = 24; fxFlash = 1;
  sfx.catch();
  if (clip.capture('busted')) hud.feed('🎬 Highlight clip saved');   // auto-clip the bust
}
function showEndScreen() {
  if (!pendingEnd) return;
  const reason = pendingEnd.reason; killcam = null;
  score += Math.floor(totalTime);
  const isBest = score > best;
  if (isBest) { best = score; localStorage.setItem('humanError.best', String(best)); }

  // fold this run into lifetime meta-progression
  const wavesCleared = wave - 1;
  const prevRank = rankFor(meta.lifeScore);
  meta.runs++; meta.waves += wavesCleared; meta.bots += stats.botsOut;
  meta.glitchHits += stats.glitchHit; meta.lifeScore += score;
  meta.bestWave = Math.max(meta.bestWave, wavesCleared);
  meta.bestScore = Math.max(meta.bestScore, score);
  try { localStorage.setItem('humanError.meta', JSON.stringify(meta)); } catch (e) {}
  const rankedUp = rankFor(meta.lifeScore) !== prevRank;

  hud.showEnd({
    title: 'CAUGHT', win: false,
    sub: (reason === 'suspicion' ? 'Suspicion maxed on wave ' : 'Hunter locked you on wave ') + wave + '.',
    statsHtml:
      `<span><b>${wavesCleared}</b>waves cleared</span>` +
      `<span><b>${score}</b>score${isBest ? ' ★' : ''}</span>` +
      `<span><b>${best}</b>best</span>` +
      `<span><b>${stats.botsOut}</b>humans busted</span>` +
      `<span><b>×${maxCombo}</b>top combo</span>` +
      `<span><b>${stats.glitchHit}/${stats.glitchTotal}</b>glitches nailed</span>`,
    flavor: rankedUp
      ? `RANK UP → ${rankFor(meta.lifeScore)}. Every caught human is a punchline — push the wave count.`
      : `Rank: ${rankFor(meta.lifeScore)} · ${meta.bots} humans busted all-time. Grab a perk, blend harder, climb.`,
  });
  pendingEnd = null;
}

// ---- main loop ----
// rAF drives rendering; the sim advances in fixed 1/60 steps (see STEP above).
let last = 0, acc = 0;
function frame(ts) {
  try { tick(ts); } catch (err) { console.error('HUMAN ERROR loop fault:', err); }
  requestAnimationFrame(frame);
}
function tick(ts) {
  const frameDt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;

  if (tutorial) { stepTutorial(Math.min(0.05, frameDt), ts); return; }

  acc += frameDt;
  let n = 0;
  while (acc >= STEP && n < 6) { stepGame(STEP); acc -= STEP; n++; }
  if (n === 6) acc = 0;   // spiral-of-death guard on very slow frames

  if (sim) renderer.render(sim, {
    player, perks, killcam, shake, particles: particles.list, labelPlayer: true,
    maxLock: maxPlayerLock(sim.hunters, player),
    surveil: { time: ts / 1000, cam: 'CAM-0' + Math.min(wave, 9), code: camCode(totalTime), flash: fxFlash, danger: fxDanger },
  });
}
function stepGame(dt) {
  if (running) {
    waveTime -= dt; totalTime += dt;
    if (decoyCD > 0) decoyCD = Math.max(0, decoyCD - dt);
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) { combo = 0; hud.setCombo(0); } }
    const ti = Math.ceil(waveTime);
    if (ti !== lastTimerInt && ti >= 0) {
      lastTimerInt = ti; hud.setTimer(ti);
      if (ti <= 10 && ti > 0) sfx.tickLow(ti);
    }
    if (waveTime <= 0) { waveTime = 0; clearWave(); }
    else {
      sim.events.length = 0;
      const preG = !!sim.glitch;
      const g = sim.stepGlitch(dt);
      if (g) { hud.showGlitch(g); sfx.glitch(); shake = Math.max(shake, 7); stats.glitchTotal++; }
      if (!sim.glitch) { hud.hideGlitch(); if (preG && hasPerk('adren')) adrenT = 4; }   // adrenaline surge

      const intent = input.intent({ sprintPerk: hasPerk('sprint') });
      if (rec) rec.frame(recTick, { [player.id]: intent });
      sim.applyHumanIntent(player, dt, intent);
      // footstep dust when moving at human speed (not the slow NPC blend-walk) —
      // a visual reminder that fast = obviously human
      if (dustCD > 0) dustCD -= dt;
      if (Math.hypot(player.vx, player.vy) > 120 && dustCD <= 0) { dustCD = 0.11; particles.puff(player.x, player.y + 10, 'rgba(150,170,200,0.5)'); }
      sim.stepCrowd(dt);

      // faint audible "tell" when a nearby bot starts slipping (rising edge, throttled)
      tellCD = Math.max(0, tellCD - dt);
      let slipNear = 0;
      for (const a of sim.agents) {
        if (!a.slipping || !a.botHider) continue;
        const dx = a.x - player.x, dy = a.y - player.y;
        if (dx * dx + dy * dy < 220 * 220) slipNear++;
      }
      if (slipNear > prevSlipNear && tellCD <= 0) { sfx.tell(); tellCD = 0.35; }
      prevSlipNear = slipNear;
      for (const h of sim.hunters) { updateHunter(h, dt, sim); if (!running) break; }
      resolveEvents();
      recTick++;
      if (running) updateSuspicion(dt);

      hud.setSuspicion(suspicion);
      const heat = Math.max(suspicion / 100 * 0.6, maxPlayerLock(sim.hunters, player));
      hud.setVignette(heat * 0.9); fxDanger = heat;
      if (heat > 0.4) { heartT -= dt; if (heartT <= 0) { heartT = clamp(0.7 - heat * 0.4, 0.18, 0.7); sfx.heart(heat); } }
    }
  }

  if (killcam) { killcam.t += dt * 0.45; if (killcam.t >= killcam.dur) showEndScreen(); }
  particles.step(dt);
  shake *= 0.86;
  fxFlash = Math.max(0, fxFlash - dt * 1.6);
  if (!running) fxDanger = Math.max(0, fxDanger - dt);
  hud.stepFeed(dt);
}

// ---- replay watch mode (/solo?replay=1) ----
// Re-simulates your last death from the recorded input stream through the
// normal renderer. Input is disabled; Space restarts, Esc exits to live play.
function startWatch() {
  input.detach();
  touch.hide();
  hud.hideOverlays();
  let rp = null;
  function load() {
    try {
      const raw = localStorage.getItem('humanError.lastReplay');
      if (!raw) { hud.feed('No replay saved yet — play (and get caught) first.'); return null; }
      return new ReplayPlayer(JSON.parse(raw));
    } catch (e) { hud.feed('Replay unavailable: ' + e.message); return null; }
  }
  rp = load();
  hud.setWave('REPLAY');
  hud.setTimerLabel(rp ? 'WAVE ' + rp.data.solo.wave + ' · SPACE RESTART · ESC EXIT' : 'NO REPLAY');
  hud.setTimer('—'); hud.setSuspicion(0);
  addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); rp = load(); }
    else if (e.key === 'Escape') { location.href = location.pathname; }
  });
  let wl = 0, wacc = 0;
  function wframe(ts) {
    const fdt = Math.min(0.1, (ts - wl) / 1000 || 0); wl = ts;
    if (rp && !rp.done) {
      wacc += fdt;
      let n = 0;
      while (rp && !rp.done && wacc >= rp.dtFor(rp.tick) && n < 6) { wacc -= rp.dtFor(rp.tick); rp.step(); n++; }
      if (n === 6) wacc = 0;
      hud.setTimer(Math.ceil((rp.data.ticks - rp.tick) * rp.data.dt));
    }
    if (rp) renderer.render(rp.sim, {
      player: rp.player, perks: new Set(), killcam: null, shake: 0, particles: particles.list,
      labelPlayer: true, maxLock: maxPlayerLock(rp.sim.hunters, rp.player),
      surveil: {
        time: ts / 1000, cam: 'CAM-0' + Math.min(rp.data.solo.wave, 9),
        code: camCode(rp.tick * rp.data.dt), flash: 0,
        danger: rp.done && rp.caught ? 0.7 : 0, replay: true,
      },
    });
    requestAnimationFrame(wframe);
  }
  requestAnimationFrame(wframe);
}

// ---- boot ----
function start() {
  initAudio();
  clip.start();
  hud.hideOverlays();
  // first-ever run gets the 30-second teaching round; afterwards drop straight in
  let taught = false;
  try { taught = !!localStorage.getItem('humanError.taught'); } catch (e) {}
  if (taught) startGame(); else startTutorial();
}
const watchMode = new URLSearchParams(location.search).get('replay') === '1';
if (watchMode) {
  startWatch();
} else {
  document.getElementById('startBtn').addEventListener('click', start);
  document.getElementById('againBtn').addEventListener('click', start);
  hud.setMeta(metaHtml());
  requestAnimationFrame(frame);
}
