"use strict";
(() => {

// ============================================================
// HUMAN ERROR — prototype v3  (wave roguelite, multi-Hunter, perks)
// ============================================================

const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
const W = cv.width, H = cv.height;

// ---------- dom ----------
const elTimer  = document.getElementById("timer");
const elTimerLabel = document.getElementById("timerLabel");
const elWave   = document.getElementById("waveTag");
const elSusp   = document.getElementById("suspFill");
const elGlitch = document.getElementById("glitch");
const elVignette = document.getElementById("vignette");
const elFeed   = document.getElementById("feed");
const startScreen = document.getElementById("startScreen");
const endScreen   = document.getElementById("endScreen");
const perkScreen  = document.getElementById("perkScreen");
const perkOpts    = document.getElementById("perkOpts");
const perkWave    = document.getElementById("perkWave");
const endTitle = document.getElementById("endTitle");
const endSub   = document.getElementById("endSub");
const endFlavor= document.getElementById("endFlavor");
const elStats  = document.getElementById("endStats");

// ---------- audio ----------
let actx = null;
function beep(freq, dur, type = "sine", vol = 0.06) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(actx.destination);
  const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur);
}
let heartT = 0;

// ---------- input ----------
const keys = {};
addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if ([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(k)) e.preventDefault();
  if (k === "q") tryDecoy();
});
addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

// ---------- helpers ----------
function rand(a, b) { return a + Math.random()*(b-a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(ax, ay, bx, by) { return Math.hypot(ax-bx, ay-by); }
function lerpAngle(a, b, t) { let d=b-a; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return a+d*t; }

// ---------- world ----------
const PAD = 40;
const ARENA = { x: PAD, y: PAD + 30, w: W - PAD*2, h: H - PAD*2 - 30 };
const SKIN = "#8a93a6", SKIN_HEAD = "#9aa3b6", SKIN_DARK = "#5b6376";
const BODY_R = 11;

const PILLARS = [
  { x: ARENA.x + ARENA.w*0.24, y: ARENA.y + ARENA.h*0.30, w: 46, h: 46 },
  { x: ARENA.x + ARENA.w*0.62, y: ARENA.y + ARENA.h*0.24, w: 54, h: 40 },
  { x: ARENA.x + ARENA.w*0.40, y: ARENA.y + ARENA.h*0.62, w: 60, h: 44 },
  { x: ARENA.x + ARENA.w*0.78, y: ARENA.y + ARENA.h*0.66, w: 44, h: 56 },
  { x: ARENA.x + ARENA.w*0.12, y: ARENA.y + ARENA.h*0.70, w: 40, h: 40 },
];

const POSE = { IDLE: "idle", WALK: "walk", DANCE: "dance" };

function collidePillars(a) {
  for (const p of PILLARS) {
    const cx = clamp(a.x, p.x, p.x+p.w), cy = clamp(a.y, p.y, p.y+p.h);
    const dx = a.x-cx, dy = a.y-cy, d = Math.hypot(dx, dy);
    if (d < BODY_R && d > 0.0001) { a.x = cx + dx/d*BODY_R; a.y = cy + dy/d*BODY_R; }
    else if (d <= 0.0001) { a.x = p.x - BODY_R; }
  }
}
function losBlocked(x0, y0, x1, y1) {
  const steps = 24;
  for (let i = 1; i < steps; i++) {
    const t = i/steps, px = x0+(x1-x0)*t, py = y0+(y1-y0)*t;
    for (const p of PILLARS) if (px>p.x && px<p.x+p.w && py>p.y && py<p.y+p.h) return true;
  }
  return false;
}
function insidePillar(x, y) {
  for (const p of PILLARS) if (x>p.x-BODY_R && x<p.x+p.w+BODY_R && y>p.y-BODY_R && y<p.y+p.h+BODY_R) return true;
  return false;
}
function freePoint(margin) {
  margin = margin || (BODY_R+8);
  for (let i = 0; i < 30; i++) {
    const x = rand(ARENA.x+25, ARENA.x+ARENA.w-25), y = rand(ARENA.y+25, ARENA.y+ARENA.h-25);
    let ok = true;
    for (const p of PILLARS) if (x>p.x-margin && x<p.x+p.w+margin && y>p.y-margin && y<p.y+p.h+margin) { ok=false; break; }
    if (ok) return { x, y };
  }
  return { x: rand(ARENA.x+25, ARENA.x+ARENA.w-25), y: rand(ARENA.y+25, ARENA.y+ARENA.h-25) };
}

// ---------- agents ----------
function makeAgent(isPlayer) {
  return {
    isPlayer, botHider: false,
    x: rand(ARENA.x+30, ARENA.x+ARENA.w-30), y: rand(ARENA.y+30, ARENA.y+ARENA.h-30),
    vx: 0, vy: 0, pose: POSE.IDLE, state: POSE.IDLE,
    timer: rand(0.5, 2.5), wpx: 0, wpy: 0,
    dancePhase: rand(0, Math.PI*2), animPhase: rand(0, Math.PI*2), facing: rand(0, Math.PI*2),
    reacting: false, reactT: 0, reacted: false,
    slipT: rand(2.5, 6), slipping: false, slip: "", slipDur: 0, sdx: 0, sdy: 0,
  };
}
function newWaypoint(a) { const p = freePoint(); a.wpx = p.x; a.wpy = p.y; }

const NPC_SPEED = 58, DANCE_DRIFT = 5;
let currentGlitch = null;

function updateNPC(a, dt) {
  a.animPhase += dt; a.timer -= dt;
  if (a.reacting) {
    a.reactT -= dt; runReaction(a, dt);
    if (a.reactT <= 0) { a.reacting = false; a.state = POSE.IDLE; a.timer = rand(0.6,1.6); }
    a.pose = a.state; collidePillars(a); return;
  }
  if (a.timer <= 0) {
    const r = Math.random();
    if (r < 0.42) { a.state = POSE.IDLE;  a.timer = rand(1.2,3.0); }
    else if (r < 0.78) { a.state = POSE.WALK; newWaypoint(a); a.timer = rand(2.0,4.0); }
    else { a.state = POSE.DANCE; a.timer = rand(1.6,3.6); }
  }
  if (a.state === POSE.IDLE) { a.vx = 0; a.vy = 0; }
  else if (a.state === POSE.WALK) {
    const dx = a.wpx-a.x, dy = a.wpy-a.y, d = Math.hypot(dx,dy);
    if (d < 6) { a.state = POSE.IDLE; a.timer = rand(0.6,1.8); a.vx = a.vy = 0; }
    else { a.vx = dx/d*NPC_SPEED; a.vy = dy/d*NPC_SPEED; a.facing = lerpAngle(a.facing, Math.atan2(dy,dx), 0.2); }
  } else if (a.state === POSE.DANCE) {
    a.dancePhase += dt*8; a.vx = Math.cos(a.dancePhase)*DANCE_DRIFT; a.vy = Math.sin(a.dancePhase*1.3)*DANCE_DRIFT;
  }
  a.x = clamp(a.x+a.vx*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
  a.y = clamp(a.y+a.vy*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  collidePillars(a); a.pose = a.state;
}

// dumb-human bots
const SLIPS = ["sprint","flinch","overdance","bunch"];
function startSlip(a) {
  a.slipping = true; a.slip = SLIPS[(Math.random()*SLIPS.length)|0]; a.slipDur = rand(0.5,1.1);
  const ang = rand(0, Math.PI*2); a.sdx = Math.cos(ang); a.sdy = Math.sin(ang);
}
function doSlip(a, dt) {
  if (a.slip === "sprint") {
    a.pose = POSE.WALK;
    a.x = clamp(a.x+a.sdx*140*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y+a.sdy*140*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
    a.facing = Math.atan2(a.sdy, a.sdx);
  } else if (a.slip === "flinch") {
    let nx = 0, ny = 0, best = 1e9;
    for (const h of hunters) { const d = dist(a.x,a.y,h.x,h.y); if (d < best){best=d; nx=a.x-h.x; ny=a.y-h.y;} }
    const d = Math.hypot(nx,ny)||1; a.pose = POSE.WALK;
    a.x = clamp(a.x+nx/d*150*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y+ny/d*150*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  } else if (a.slip === "overdance") { a.pose = POSE.DANCE; a.dancePhase += dt*18; a.vx = a.vy = 0; }
  else if (a.slip === "bunch") {
    a.pose = POSE.WALK;
    a.x = clamp(a.x+a.sdx*70*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y+a.sdy*70*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  }
}
function updateBot(a, dt) {
  if (a.reacting) { updateNPC(a, dt); return; }
  if (!a.slipping) { a.slipT -= dt; if (a.slipT <= 0) startSlip(a); }
  if (a.slipping) {
    a.slipDur -= dt; a.animPhase += dt; doSlip(a, dt); collidePillars(a);
    if (a.slipDur <= 0) { a.slipping = false; a.slipT = rand(2.8,6.5); }
    return;
  }
  updateNPC(a, dt);
}

function runReaction(a, dt) {
  if (!currentGlitch) return;
  if (currentGlitch.type === "alarm") {
    const ex = a.x < W/2 ? ARENA.x+24 : ARENA.x+ARENA.w-24, ey = ARENA.y+24;
    const dx = ex-a.x, dy = ey-a.y, d = Math.hypot(dx,dy)||1;
    a.x = clamp(a.x+dx/d*135*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y+dy/d*135*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
    a.facing = Math.atan2(dy,dx); a.state = POSE.WALK;
  } else if (currentGlitch.type === "cash") {
    const dx = W/2-a.x, dy = (ARENA.y+ARENA.h/2)-a.y, d = Math.hypot(dx,dy)||1;
    a.x = clamp(a.x+dx/d*115*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y+dy/d*115*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
    a.facing = Math.atan2(dy,dx); a.state = POSE.WALK;
  } else if (currentGlitch.type === "freeze") { a.vx = a.vy = 0; a.state = POSE.IDLE; }
}

// ---------- hunters (array) ----------
function makeHunter(i, total) {
  const fx = ARENA.x + ARENA.w*((i+1)/(total+1));
  return {
    x: fx, y: ARENA.y+28, vx: 0, vy: 0, facing: Math.PI/2,
    scanR: 160, scanHalf: 0.62, target: null, retargetT: rand(0,0.4),
    catchR: 26, px: 0, py: 0, lock: 0, stuckT: 0, lastx: fx, lasty: ARENA.y+28,
    inspect: 0,
  };
}
let hunters = [];

// ---------- perks ----------
const ALL_PERKS = [
  { id: "calm",   name: "Nerves of Steel", desc: "Suspicion builds 30% slower." },
  { id: "decay",  name: "Cool Customer",   desc: "Blend cooldown is 70% faster." },
  { id: "ghost",  name: "Ghost Step",      desc: "While Shift-walking, scans barely read you." },
  { id: "decoy",  name: "Decoy Drop",      desc: "Press Q: drop a fake that pulls Hunters. (12s)" },
  { id: "sprint", name: "Second Wind",     desc: "Sprint faster — outrun the Hunter." },
  { id: "radar",  name: "Sixth Sense",     desc: "See a line to whoever each Hunter is locking." },
];
let perks = new Set();
function hasPerk(id) { return perks.has(id); }

// ---------- game state ----------
let agents = [], player = null, decoys = [];
let wave = 1, waveTime = 0, running = false, betweenWaves = false;
let suspicion = 0, shake = 0, particles = [];
let glitchCooldown = 6, lastTimerInt = 0;
let totalTime = 0, score = 0, decoyCD = 0;
let stats = { botsOut: 0, glitchHit: 0, glitchTotal: 0 };
let killcam = null, pendingEnd = null;

const NPC_COUNT = 33, N_BOTS = 3;
const WAVE_SECS = 40;
let best = parseInt(localStorage.getItem("humanError.best") || "0", 10) || 0;

function huntersForWave(w) { return clamp(1 + Math.floor((w-1)/2), 1, 4); }
function lockSpeed() { return 0.78 + wave*0.05; }

function placeFree(a) {
  let t = 0;
  while (insidePillar(a.x, a.y) && t++ < 20) { a.x = rand(ARENA.x+30,ARENA.x+ARENA.w-30); a.y = rand(ARENA.y+30,ARENA.y+ARENA.h-30); }
}
function buildCrowd() {
  agents = [];
  for (let i = 0; i < NPC_COUNT; i++) { const a = makeAgent(false); placeFree(a); agents.push(a); }
  for (let i = 0; i < N_BOTS; i++) { const a = makeAgent(false); a.botHider = true; placeFree(a); agents.push(a); }
  player = makeAgent(true);
  player.x = ARENA.x + ARENA.w/2; player.y = ARENA.y + ARENA.h - 55;
  agents.push(player);
}
function setupHunters() {
  const n = huntersForWave(wave);
  hunters = [];
  for (let i = 0; i < n; i++) {
    const h = makeHunter(i, n);
    h.scanR = 150 + wave*8;
    hunters.push(h);
  }
}

function startGame() {
  wave = 1; totalTime = 0; score = 0; perks = new Set(); decoys = []; decoyCD = 0;
  stats = { botsOut: 0, glitchHit: 0, glitchTotal: 0 };
  beginWave();
}
function beginWave() {
  buildCrowd();
  setupHunters();
  waveTime = WAVE_SECS; suspicion = 0; running = true; betweenWaves = false;
  shake = 0; particles = []; currentGlitch = null; glitchCooldown = rand(4,7);
  lastTimerInt = Math.ceil(waveTime); killcam = null; pendingEnd = null;
  elGlitch.style.opacity = "0";
  elWave.textContent = "WAVE " + wave;
  elTimerLabel.textContent = "SURVIVE · " + hunters.length + (hunters.length>1?" HUNTERS":" HUNTER");
}

// ---------- player ----------
let PLAYER_SPEED = 140;
function updatePlayer(dt) {
  player.animPhase += dt;
  let ix = 0, iy = 0;
  if (keys["a"]||keys["arrowleft"]) ix -= 1;
  if (keys["d"]||keys["arrowright"]) ix += 1;
  if (keys["w"]||keys["arrowup"]) iy -= 1;
  if (keys["s"]||keys["arrowdown"]) iy += 1;
  const slow = keys["shift"];
  const spd = slow ? NPC_SPEED : (hasPerk("sprint") ? 175 : 140);
  if (ix || iy) {
    const d = Math.hypot(ix,iy);
    player.vx = ix/d*spd; player.vy = iy/d*spd;
    player.facing = lerpAngle(player.facing, Math.atan2(iy,ix), 0.3);
    player.pose = POSE.WALK;
  } else {
    player.vx = 0; player.vy = 0;
    if (keys["f"]) { player.pose = POSE.DANCE; player.dancePhase += dt*8; }
    else player.pose = POSE.IDLE;
  }
  player.x = clamp(player.x+player.vx*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
  player.y = clamp(player.y+player.vy*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  collidePillars(player);

  if (currentGlitch && !player.reacted && (keys[" "]||keys["e"])) {
    player.reacted = true; player.reacting = true; player.reactT = Math.max(0.2, currentGlitch.t);
    if (currentGlitch.t > currentGlitch.t0 - currentGlitch.window) stats.glitchHit++;
    beep(680, 0.08, "triangle", 0.05);
  }
}
function tryDecoy() {
  if (!running || !hasPerk("decoy") || decoyCD > 0 || !player) return;
  decoys.push({ x: player.x, y: player.y, t: 4 });
  decoyCD = 12; beep(520, 0.12, "triangle", 0.06); shake = Math.max(shake, 5);
  feed("Decoy dropped");
}

// ---------- suspicion / detection ----------
function neighborStats(a, radius) {
  let sum = 0, n = 0, poses = { idle:0, walk:0, dance:0 };
  for (const o of agents) {
    if (o === a || o.isPlayer) continue;
    if (dist(a.x,a.y,o.x,o.y) < radius) { sum += Math.hypot(o.vx,o.vy); n++; poses[o.pose] = (poses[o.pose]||0)+1; }
  }
  let maj = "idle", mc = -1;
  for (const k in poses) if (poses[k] > mc) { mc = poses[k]; maj = k; }
  return { avgSpeed: n ? sum/n : 0, n, majority: maj };
}
function inCone(hx, hy, facing, half, range, tx, ty) {
  const dx = tx-hx, dy = ty-hy, d = Math.hypot(dx,dy);
  if (d > range) return false;
  let ang = Math.atan2(dy,dx)-facing; while(ang>Math.PI)ang-=Math.PI*2; while(ang<-Math.PI)ang+=Math.PI*2;
  return Math.abs(ang) < half;
}
function seesAgent(h, a) {
  return inCone(h.x,h.y,h.facing,h.scanHalf,h.scanR,a.x,a.y) && !losBlocked(h.x,h.y,a.x,a.y);
}
function anyHunterSeesPlayer() {
  for (const h of hunters) if (seesAgent(h, player)) return true;
  return false;
}
function humanScore(a) {
  const ns = neighborStats(a, 95);
  const sp = Math.hypot(a.vx, a.vy);
  let s = 0;
  s += Math.abs(sp - ns.avgSpeed) * 0.16;
  if (sp > NPC_SPEED+6) s += (sp-NPC_SPEED)*0.22;
  if (ns.n >= 3 && a.pose !== ns.majority) s += 10;
  if (currentGlitch && a.reacting === false && a.reacted === false) s += 14;
  return s;
}
function maxPlayerLock() { let m = 0; for (const h of hunters) if (h.target === player) m = Math.max(m, h.lock); return m; }

function updateSuspicion(dt) {
  const ghosting = hasPerk("ghost") && keys["shift"];
  const seen = !ghosting && anyHunterSeesPlayer();
  let rate = 0;
  if (seen) { rate += humanScore(player); rate += 5; }
  let cool = -13 * (hasPerk("decay") ? 1.7 : 1);
  if (rate < 4) rate = cool;
  if (hasPerk("calm") && rate > 0) rate *= 0.7;
  suspicion = clamp(suspicion + rate*dt, 0, 100);
  if (suspicion >= 100 && running) endGame("suspicion");
}

// ---------- hunter AI ----------
function updateHunter(h, dt) {
  h.retargetT -= dt;
  if (h.retargetT <= 0) {
    h.retargetT = 0.38;
    let best = null, bestScore = 16;
    // decoys are irresistible
    for (const d of decoys) {
      if (inCone(h.x,h.y,h.facing,h.scanHalf,h.scanR,d.x,d.y) && !losBlocked(h.x,h.y,d.x,d.y)) {
        const s = 80; if (s > bestScore) { bestScore = s; best = d; }
      }
    }
    for (const a of agents) {
      if (!seesAgent(h, a)) continue;
      const s = humanScore(a);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    h.target = best;
  }

  if (h.target === player && seesAgent(h, player)) {
    const near = dist(h.x,h.y,player.x,player.y) < 90 ? 1.4 : 1;
    h.lock = clamp(h.lock + dt*lockSpeed()*near, 0, 1);
    h.inspect = 1;
  } else { h.lock = clamp(h.lock - dt*0.7, 0, 1); h.inspect = Math.max(0, h.inspect-dt*2); }

  if (h.target && h.target.x !== undefined && losBlocked(h.x, h.y, h.target.x, h.target.y) && !h.target.isDecoy) h.target = null;

  let tx, ty;
  if (h.target) { tx = h.target.x; ty = h.target.y; }
  else {
    if (!h.px || dist(h.x,h.y,h.px,h.py) < 30) { const fp = freePoint(BODY_R+14); h.px = fp.x; h.py = fp.y; }
    tx = h.px; ty = h.py;
  }
  const dx = tx-h.x, dy = ty-h.y, d = Math.hypot(dx,dy)||1;
  // slows to a menacing "inspection" creep when locking the player
  const hSpeed = h.target ? (h.inspect>0.3 && h.lock>0.3 ? 96 : 120) : 84;
  h.x = clamp(h.x+dx/d*hSpeed*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
  h.y = clamp(h.y+dy/d*hSpeed*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  collidePillars(h);
  h.facing = lerpAngle(h.facing, Math.atan2(dy,dx), 3.2*dt);

  const moved = dist(h.x,h.y,h.lastx,h.lasty); h.lastx = h.x; h.lasty = h.y;
  if (moved < hSpeed*dt*0.35) h.stuckT += dt; else h.stuckT = 0;
  if (h.stuckT > 0.7) { h.target = null; const fp = freePoint(BODY_R+14); h.px = fp.x; h.py = fp.y; h.stuckT = 0; }

  // catch player
  if (h.target === player && h.lock > 0.55 && dist(h.x,h.y,player.x,player.y) < h.catchR) { endGame("caught"); return; }
  // pop a bot
  if (h.target && h.target.botHider && dist(h.x,h.y,h.target.x,h.target.y) < h.catchR) eliminateBot(h.target);
  // hit a decoy
  if (h.target && h.target.isDecoy && dist(h.x,h.y,h.target.x,h.target.y) < h.catchR) {
    const i = decoys.indexOf(h.target); if (i>=0) decoys.splice(i,1);
    h.target = null; burst(h.x, h.y, "#38bdf8", 12);
  }
}
function eliminateBot(bot) {
  const i = agents.indexOf(bot); if (i >= 0) agents.splice(i, 1);
  burst(bot.x, bot.y, "#ff2e63", 22); stats.botsOut++; score += 10;
  for (const h of hunters) if (h.target === bot) { h.target = null; h.lock = 0; }
  shake = Math.max(shake, 8); feed("A human was caught!");
  beep(160,0.1,"square",0.06); setTimeout(()=>beep(110,0.18,"sawtooth",0.05),90);
}

// ---------- glitch ----------
const GLITCHES = [
  { type: "alarm",  name: "🚨 FIRE ALARM",   sub: "SPACE — run for an exit!",       window: 1.5, t: 2.4 },
  { type: "cash",   name: "💸 CASH DROPPED",  sub: "SPACE — rush the center!",       window: 1.5, t: 2.2 },
  { type: "freeze", name: "🧊 SYSTEM FREEZE", sub: "SPACE — hold perfectly still!",  window: 1.5, t: 1.9 },
];
function triggerGlitch() {
  const g = { ...GLITCHES[(Math.random()*GLITCHES.length)|0] }; g.t0 = g.t;
  currentGlitch = g; stats.glitchTotal++;
  for (const a of agents) {
    if (a.isPlayer) { a.reacted = false; a.reacting = false; continue; }
    if (a.botHider && Math.random() < 0.45) { a.reacting = false; a.reacted = false; continue; }
    a.reacting = true; a.reactT = g.t;
  }
  player.reacted = false; player.reacting = false;
  elGlitch.innerHTML = g.name + "<small>" + g.sub + "</small>"; elGlitch.style.opacity = "1";
  beep(170,0.25,"sawtooth",0.08); shake = Math.max(shake, 7);
}
function clearGlitch() { currentGlitch = null; elGlitch.style.opacity = "0"; }

// ---------- particles / feed ----------
function burst(x, y, color, n = 18) {
  for (let i = 0; i < n; i++) { const a = rand(0,Math.PI*2), s = rand(40,230); particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: rand(.4,.95), color }); }
}
let feedItems = [];
function feed(msg) { feedItems.unshift({ msg, t: 2.6 }); if (feedItems.length > 4) feedItems.pop(); renderFeed(); }
function renderFeed() { elFeed.innerHTML = feedItems.map(f => `<div style="opacity:${clamp(f.t/2.6,0,1).toFixed(2)}">${f.msg}</div>`).join(""); }

// ---------- wave clear / perks ----------
function clearWave() {
  running = false; betweenWaves = true;
  score += 100;
  perkWave.textContent = "WAVE " + wave + " CLEARED";
  // offer 3 perks the player doesn't already have (fall back to any if exhausted)
  let pool = ALL_PERKS.filter(p => !perks.has(p.id));
  if (pool.length < 3) pool = ALL_PERKS.slice();
  pool = pool.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  perkOpts.innerHTML = "";
  for (const p of pool) {
    const b = document.createElement("button");
    b.className = "perkCard";
    b.innerHTML = `<b>${p.name}</b><span>${p.desc}</span>`;
    b.onclick = () => choosePerk(p.id);
    perkOpts.appendChild(b);
  }
  perkScreen.classList.remove("hidden");
  beep(523,0.1,"triangle"); setTimeout(()=>beep(784,0.16,"triangle"),110);
}
function choosePerk(id) {
  perks.add(id);
  perkScreen.classList.add("hidden");
  wave++;
  beginWave();
}

// ---------- end ----------
function endGame(reason) {
  if (!running) return;
  running = false;
  for (const h of hunters) h.lock = 0;
  elVignette.style.opacity = "0";
  pendingEnd = { reason };
  killcam = { x: player.x, y: player.y, t: 0, dur: 2.4 };
  burst(player.x, player.y, "#ff2e63", 40); shake = 18;
  beep(220,0.12,"sawtooth"); setTimeout(()=>beep(140,0.25,"sawtooth"),120);
}
function showEndScreen() {
  if (!pendingEnd) return;
  const reason = pendingEnd.reason;
  killcam = null;
  score += Math.floor(totalTime);
  const isBest = score > best;
  if (isBest) { best = score; localStorage.setItem("humanError.best", String(best)); }
  endScreen.classList.remove("hidden", "win", "lose"); endScreen.classList.add("lose");
  endTitle.textContent = "CAUGHT";
  endSub.textContent = (reason === "suspicion" ? "Suspicion maxed on wave " : "Hunter locked you on wave ") + wave + ".";
  elStats.innerHTML =
    `<span><b>${wave-1}</b>waves cleared</span>` +
    `<span><b>${score}</b>score${isBest?" ★":""}</span>` +
    `<span><b>${best}</b>best</span>` +
    `<span><b>${stats.botsOut}</b>bots busted</span>`;
  endFlavor.textContent = "Every caught human is a punchline. Grab a perk, blend harder, push the wave count.";
  pendingEnd = null;
}

// ---------- drawing ----------
function drawPerson(a, isHunter) {
  const moving = Math.hypot(a.vx, a.vy) > 4;
  const dancing = a.pose === POSE.DANCE;
  const t = a.animPhase;
  const locked = isHunter && a.target === player;
  const bodyCol = isHunter ? (locked ? "#ff2e63" : "#3aa0ff") : SKIN;
  const headCol = isHunter ? "#cfe6ff" : SKIN_HEAD;
  ctx.save(); ctx.translate(a.x, a.y);
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(0,11,9,3.2,0,0,Math.PI*2); ctx.fill();
  const swing = moving ? Math.sin(t*11)*4 : 0;
  ctx.strokeStyle = SKIN_DARK; ctx.lineWidth = 3.2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-2.5,4); ctx.lineTo(-2.5+swing*0.4,11); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2.5,4); ctx.lineTo(2.5-swing*0.4,11); ctx.stroke();
  const bob = dancing ? Math.sin(a.dancePhase)*1.6 : (moving ? Math.abs(Math.sin(t*11))*0.8 : Math.sin(t*2)*0.5);
  ctx.fillStyle = bodyCol; roundRect(-5,-6+bob,10,12,4); ctx.fill();
  ctx.strokeStyle = bodyCol; ctx.lineWidth = 3;
  if (dancing) {
    const w = Math.sin(a.dancePhase*1.5)*0.5;
    ctx.beginPath(); ctx.moveTo(-4,-3+bob); ctx.lineTo(-8,-9+w*3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4,-3+bob); ctx.lineTo(8,-9-w*3); ctx.stroke();
  } else if (moving) {
    const s2 = Math.sin(t*11)*3;
    ctx.beginPath(); ctx.moveTo(-4,-2+bob); ctx.lineTo(-5,3+s2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4,-2+bob); ctx.lineTo(5,3-s2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(-4,-2+bob); ctx.lineTo(-5,3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4,-2+bob); ctx.lineTo(5,3); ctx.stroke();
  }
  ctx.fillStyle = headCol; ctx.beginPath(); ctx.arc(0,-10+bob,5,0,Math.PI*2); ctx.fill();
  if (isHunter) {
    ctx.fillStyle = "rgba(10,20,35,.9)"; ctx.save(); ctx.translate(0,-10+bob); ctx.rotate(a.facing);
    roundRect(1,-2.4,4.5,4.8,1.5); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function draw() {
  ctx.clearRect(0,0,W,H);
  ctx.save();
  if (shake > 0.2) ctx.translate(rand(-shake,shake), rand(-shake,shake));
  if (killcam) {
    const e = clamp(killcam.t/0.5,0,1), ez = 1-Math.pow(1-e,3), zoom = 1+1.6*ez;
    ctx.translate(W/2,H/2); ctx.scale(zoom,zoom); ctx.translate(-killcam.x,-killcam.y);
  }
  ctx.fillStyle = "#0e1422"; ctx.fillRect(ARENA.x,ARENA.y,ARENA.w,ARENA.h);
  ctx.strokeStyle = "#172033"; ctx.lineWidth = 1;
  for (let gx = ARENA.x; gx <= ARENA.x+ARENA.w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx,ARENA.y); ctx.lineTo(gx,ARENA.y+ARENA.h); ctx.stroke(); }
  for (let gy = ARENA.y; gy <= ARENA.y+ARENA.h; gy += 40) { ctx.beginPath(); ctx.moveTo(ARENA.x,gy); ctx.lineTo(ARENA.x+ARENA.w,gy); ctx.stroke(); }

  if (currentGlitch) {
    if (currentGlitch.type === "cash") { ctx.fillStyle = "rgba(245,185,66,.18)"; ctx.beginPath(); ctx.arc(W/2,ARENA.y+ARENA.h/2,42,0,Math.PI*2); ctx.fill(); }
    else if (currentGlitch.type === "alarm") { ctx.fillStyle = "rgba(255,46,99,.10)"; ctx.fillRect(ARENA.x,ARENA.y,ARENA.w,ARENA.h); }
  }

  // hunter cones
  for (const h of hunters) {
    ctx.save(); ctx.translate(h.x,h.y); ctx.rotate(h.facing);
    const grd = ctx.createRadialGradient(0,0,10,0,0,h.scanR);
    const hot = h.target ? "rgba(255,46,99,0.24)" : "rgba(58,160,255,0.15)";
    grd.addColorStop(0,hot); grd.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,h.scanR,-h.scanHalf,h.scanHalf); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // pillars
  for (const p of PILLARS) {
    ctx.fillStyle = "#1c2942"; roundRect(p.x,p.y,p.w,p.h,6); ctx.fill();
    ctx.strokeStyle = "#2c3e5e"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.04)"; roundRect(p.x+3,p.y+3,p.w-6,6,3); ctx.fill();
  }
  // decoys
  for (const d of decoys) {
    ctx.globalAlpha = clamp(d.t,0,1)*0.8;
    ctx.fillStyle = "#38bdf8"; ctx.beginPath(); ctx.arc(d.x,d.y,BODY_R,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = "#243149"; ctx.lineWidth = 2; ctx.strokeRect(ARENA.x,ARENA.y,ARENA.w,ARENA.h);

  const drawn = agents.filter(a => !a.isPlayer).slice().sort((p,q)=>p.y-q.y);
  for (const a of drawn) drawPerson(a, false);

  if (player) {
    drawPerson(player, false);
    ctx.beginPath(); ctx.strokeStyle = "rgba(43,212,121,.9)"; ctx.lineWidth = 2;
    ctx.arc(player.x,player.y,BODY_R+7,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle = "rgba(43,212,121,.95)"; ctx.font = "bold 10px Segoe UI"; ctx.textAlign = "center";
    ctx.fillText("YOU", player.x, player.y-BODY_R-16);
    const lk = maxPlayerLock();
    if (lk > 0.02) {
      ctx.beginPath(); ctx.strokeStyle = "rgba(255,46,99,.9)"; ctx.lineWidth = 3;
      ctx.arc(player.x,player.y,BODY_R+12,-Math.PI/2,-Math.PI/2+Math.PI*2*lk); ctx.stroke();
    }
  }

  for (const h of hunters) {
    // radar perk: line to who it's locking
    if (hasPerk("radar") && h.target && h.target.x !== undefined) {
      ctx.strokeStyle = "rgba(255,46,99,.35)"; ctx.lineWidth = 1.5; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(h.x,h.y); ctx.lineTo(h.target.x,h.target.y); ctx.stroke(); ctx.setLineDash([]);
    }
    drawPerson(h, true);
  }

  for (const p of particles) { ctx.globalAlpha = clamp(p.life,0,1); ctx.fillStyle = p.color; ctx.fillRect(p.x,p.y,3,3); }
  ctx.globalAlpha = 1;

  if (killcam) {
    const pulse = 2 + Math.sin(killcam.t*12)*1.2;
    ctx.beginPath(); ctx.strokeStyle = "rgba(255,46,99,.95)"; ctx.lineWidth = pulse;
    ctx.arc(killcam.x,killcam.y,BODY_R+6,0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();

  if (killcam && killcam.t > 0.45) {
    const a = clamp((killcam.t-0.45)/0.3,0,1);
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = "center";
    ctx.fillStyle = "#ff2e63"; ctx.font = "900 64px Segoe UI"; ctx.fillText("HUMAN ERROR", W/2, H/2-8);
    ctx.fillStyle = "#e8edf5"; ctx.font = "700 20px Segoe UI"; ctx.fillText("CAUGHT — too human.", W/2, H/2+30);
    ctx.restore();
  }
}

// ---------- loop ----------
let last = 0;
function frame(ts) { try { tick(ts); } catch (err) { console.error("HUMAN ERROR loop fault:", err); } requestAnimationFrame(frame); }
function tick(ts) {
  const dt = Math.min(0.05, (ts-last)/1000 || 0); last = ts;

  if (running) {
    waveTime -= dt; totalTime += dt;
    if (decoyCD > 0) decoyCD = Math.max(0, decoyCD - dt);
    const ti = Math.ceil(waveTime);
    if (ti !== lastTimerInt && ti >= 0) {
      lastTimerInt = ti; elTimer.textContent = ti;
      if (ti <= 10 && ti > 0) beep(440+(10-ti)*40, 0.05, "square", 0.04);
    }
    if (waveTime <= 0) { waveTime = 0; clearWave(); }
    else {
      if (!currentGlitch) { glitchCooldown -= dt; if (glitchCooldown <= 0) triggerGlitch(); }
      else { currentGlitch.t -= dt; if (currentGlitch.t <= 0) { clearGlitch(); glitchCooldown = rand(6,11); } }

      updatePlayer(dt);
      for (const a of agents) { if (a.isPlayer) continue; if (a.botHider) updateBot(a, dt); else updateNPC(a, dt); }
      if (player.reacting) { player.reactT -= dt; runReaction(player, dt); collidePillars(player); if (player.reactT <= 0) player.reacting = false; }
      for (const d of decoys) d.t -= dt;
      decoys = decoys.filter(d => d.t > 0);
      for (const h of hunters) { updateHunter(h, dt); if (!running) break; }
      if (running) updateSuspicion(dt);

      elSusp.style.width = suspicion.toFixed(1) + "%";
      const heat = Math.max(suspicion/100*0.6, maxPlayerLock());
      elVignette.style.opacity = (heat*0.9).toFixed(2);
      if (heat > 0.4) { heartT -= dt; if (heartT <= 0) { heartT = clamp(0.7-heat*0.4,0.18,0.7); beep(60,0.12,"sine",0.05*heat); } }
    }
  }

  if (killcam) { killcam.t += dt*0.45; if (killcam.t >= killcam.dur) showEndScreen(); }

  for (const p of particles) { p.x += p.vx*dt; p.y += p.vy*dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  shake *= 0.86;
  if (feedItems.length) { let dirty = false; for (const f of feedItems) { f.t -= dt; if (f.t < 0.6) dirty = true; } const before = feedItems.length; feedItems = feedItems.filter(f => f.t > 0); if (dirty || feedItems.length !== before) renderFeed(); }

  draw();
}

// ---------- start ----------
function start() {
  if (!actx) { try { actx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){} }
  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  perkScreen.classList.add("hidden");
  startGame();
}
document.getElementById("startBtn").addEventListener("click", start);
document.getElementById("againBtn").addEventListener("click", start);
addEventListener("keydown", e => {
  if (e.key === "Enter") {
    if (!startScreen.classList.contains("hidden")) start();
    else if (!endScreen.classList.contains("hidden")) start();
  }
});

if (best > 0) { /* surfaced on end screen */ }
requestAnimationFrame(frame);
})();
