"use strict";
(() => {

// ============================================================
// HUMAN ERROR — prototype v2
// ============================================================

// ---------- canvas ----------
const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
const W = cv.width, H = cv.height;

// ---------- dom ----------
const elTimer  = document.getElementById("timer");
const elSusp   = document.getElementById("suspFill");
const elGlitch = document.getElementById("glitch");
const elVignette = document.getElementById("vignette");
const startScreen = document.getElementById("startScreen");
const endScreen   = document.getElementById("endScreen");
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
  keys[e.key.toLowerCase()] = true;
  if ([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
});
addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

// ---------- helpers ----------
function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function lerpAngle(a, b, t) {
  let d = b - a; while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2;
  return a + d * t;
}

// ---------- world ----------
const PAD = 40;
const ARENA = { x: PAD, y: PAD + 30, w: W - PAD*2, h: H - PAD*2 - 30 };
const SKIN = "#8a93a6", SKIN_HEAD = "#9aa3b6", SKIN_DARK = "#5b6376";
const BODY_R = 11;

// pillars — cover that blocks line of sight
const PILLARS = [
  { x: ARENA.x + ARENA.w*0.24, y: ARENA.y + ARENA.h*0.30, w: 46, h: 46 },
  { x: ARENA.x + ARENA.w*0.62, y: ARENA.y + ARENA.h*0.24, w: 54, h: 40 },
  { x: ARENA.x + ARENA.w*0.40, y: ARENA.y + ARENA.h*0.62, w: 60, h: 44 },
  { x: ARENA.x + ARENA.w*0.78, y: ARENA.y + ARENA.h*0.66, w: 44, h: 56 },
  { x: ARENA.x + ARENA.w*0.12, y: ARENA.y + ARENA.h*0.70, w: 40, h: 40 },
];

const POSE = { IDLE: "idle", WALK: "walk", DANCE: "dance" };

// circle vs rect push-out
function collidePillars(a) {
  for (const p of PILLARS) {
    const cx = clamp(a.x, p.x, p.x + p.w);
    const cy = clamp(a.y, p.y, p.y + p.h);
    const dx = a.x - cx, dy = a.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < BODY_R && d > 0.0001) {
      a.x = cx + dx/d * BODY_R;
      a.y = cy + dy/d * BODY_R;
    } else if (d <= 0.0001) {
      a.x = p.x - BODY_R; // inside: shove left
    }
  }
}

// line of sight: blocked if segment crosses any pillar
function losBlocked(x0, y0, x1, y1) {
  const steps = 24;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x0 + (x1-x0)*t, py = y0 + (y1-y0)*t;
    for (const p of PILLARS) {
      if (px > p.x && px < p.x+p.w && py > p.y && py < p.y+p.h) return true;
    }
  }
  return false;
}

// ---------- agents ----------
function makeAgent(isPlayer) {
  return {
    isPlayer,
    botHider: false,
    x: rand(ARENA.x + 30, ARENA.x + ARENA.w - 30),
    y: rand(ARENA.y + 30, ARENA.y + ARENA.h - 30),
    vx: 0, vy: 0,
    pose: POSE.IDLE,
    state: POSE.IDLE,
    timer: rand(0.5, 2.5),
    wpx: 0, wpy: 0,
    dancePhase: rand(0, Math.PI*2),
    animPhase: rand(0, Math.PI*2),
    facing: rand(0, Math.PI*2),
    reacting: false, reactT: 0, reacted: false,
    // dumb-human-bot slip state
    slipT: rand(2.5, 6), slipping: false, slip: "", slipDur: 0, sdx: 0, sdy: 0,
  };
}

function freePoint(margin) {
  margin = margin || (BODY_R + 8);
  for (let i = 0; i < 30; i++) {
    const x = rand(ARENA.x + 25, ARENA.x + ARENA.w - 25);
    const y = rand(ARENA.y + 25, ARENA.y + ARENA.h - 25);
    let ok = true;
    for (const p of PILLARS) {
      if (x > p.x - margin && x < p.x + p.w + margin && y > p.y - margin && y < p.y + p.h + margin) { ok = false; break; }
    }
    if (ok) return { x, y };
  }
  return { x: rand(ARENA.x+25, ARENA.x+ARENA.w-25), y: rand(ARENA.y+25, ARENA.y+ARENA.h-25) };
}
function newWaypoint(a) {
  const p = freePoint();
  a.wpx = p.x; a.wpy = p.y;
}

const NPC_SPEED = 58;
const PLAYER_SPEED = 140;       // human top speed > NPC walk = the trap
const DANCE_DRIFT = 5;

let currentGlitch = null;

function updateNPC(a, dt) {
  a.animPhase += dt;
  a.timer -= dt;

  if (a.reacting) {
    a.reactT -= dt;
    runReaction(a, dt);
    if (a.reactT <= 0) { a.reacting = false; a.state = POSE.IDLE; a.timer = rand(0.6, 1.6); }
    a.pose = a.state;
    collidePillars(a);
    return;
  }

  if (a.timer <= 0) {
    const r = Math.random();
    if (r < 0.42) { a.state = POSE.IDLE;  a.timer = rand(1.2, 3.0); }
    else if (r < 0.78) { a.state = POSE.WALK; newWaypoint(a); a.timer = rand(2.0, 4.0); }
    else { a.state = POSE.DANCE; a.timer = rand(1.6, 3.6); }
  }

  if (a.state === POSE.IDLE) {
    a.vx = 0; a.vy = 0;
  } else if (a.state === POSE.WALK) {
    const dx = a.wpx - a.x, dy = a.wpy - a.y, d = Math.hypot(dx, dy);
    if (d < 6) { a.state = POSE.IDLE; a.timer = rand(0.6, 1.8); a.vx = a.vy = 0; }
    else { a.vx = (dx/d)*NPC_SPEED; a.vy = (dy/d)*NPC_SPEED; a.facing = lerpAngle(a.facing, Math.atan2(dy,dx), 0.2); }
  } else if (a.state === POSE.DANCE) {
    a.dancePhase += dt*8;
    a.vx = Math.cos(a.dancePhase)*DANCE_DRIFT;
    a.vy = Math.sin(a.dancePhase*1.3)*DANCE_DRIFT;
  }

  a.x = clamp(a.x + a.vx*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
  a.y = clamp(a.y + a.vy*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  collidePillars(a);
  a.pose = a.state;
}

// dumb-human bots: AI hiders that mostly blend but periodically SLIP like a real
// human would — so the joke reads even when the player is doing everything right.
const SLIPS = ["sprint", "flinch", "overdance", "bunch"];
function startSlip(a) {
  a.slipping = true;
  a.slip = SLIPS[(Math.random()*SLIPS.length)|0];
  a.slipDur = rand(0.5, 1.1);
  const ang = rand(0, Math.PI*2);
  a.sdx = Math.cos(ang); a.sdy = Math.sin(ang);
}
function doSlip(a, dt) {
  if (a.slip === "sprint") {                 // panic dash
    a.pose = POSE.WALK;
    a.x = clamp(a.x + a.sdx*PLAYER_SPEED*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y + a.sdy*PLAYER_SPEED*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
    a.facing = Math.atan2(a.sdy, a.sdx);
  } else if (a.slip === "flinch") {          // bolt away from the Hunter
    const dx = a.x - hunter.x, dy = a.y - hunter.y, d = Math.hypot(dx,dy)||1;
    a.pose = POSE.WALK;
    a.x = clamp(a.x + dx/d*150*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y + dy/d*150*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
    a.facing = Math.atan2(dy, dx);
  } else if (a.slip === "overdance") {        // too-perfect, too-fast dance
    a.pose = POSE.DANCE; a.dancePhase += dt*18;
    a.vx = a.vy = 0;
  } else if (a.slip === "bunch") {            // crowd the nearest body
    a.pose = POSE.WALK;
    a.x = clamp(a.x + a.sdx*70*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y + a.sdy*70*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  }
}
function updateBot(a, dt) {
  if (a.reacting) { updateNPC(a, dt); return; }   // glitch reaction handled by NPC path
  if (!a.slipping) {
    a.slipT -= dt;
    if (a.slipT <= 0) startSlip(a);
  }
  if (a.slipping) {
    a.slipDur -= dt;
    a.animPhase += dt;
    doSlip(a, dt);
    collidePillars(a);
    if (a.slipDur <= 0) { a.slipping = false; a.slipT = rand(2.8, 6.5); }
    return;
  }
  updateNPC(a, dt);   // blends normally most of the time
}

// glitch reaction motions
function runReaction(a, dt) {
  if (!currentGlitch) return;
  if (currentGlitch.type === "alarm") {
    const ex = a.x < W/2 ? ARENA.x + 24 : ARENA.x + ARENA.w - 24, ey = ARENA.y + 24;
    const dx = ex-a.x, dy = ey-a.y, d = Math.hypot(dx,dy)||1;
    a.x = clamp(a.x + dx/d*135*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y + dy/d*135*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
    a.facing = Math.atan2(dy,dx); a.state = POSE.WALK;
  } else if (currentGlitch.type === "cash") {
    const dx = W/2-a.x, dy = (ARENA.y+ARENA.h/2)-a.y, d = Math.hypot(dx,dy)||1;
    a.x = clamp(a.x + dx/d*115*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
    a.y = clamp(a.y + dy/d*115*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
    a.facing = Math.atan2(dy,dx); a.state = POSE.WALK;
  } else if (currentGlitch.type === "freeze") {
    a.vx = a.vy = 0; a.state = POSE.IDLE;
  }
}

// ---------- hunter ----------
const hunter = {
  x: W/2, y: ARENA.y + 28, vx: 0, vy: 0, facing: Math.PI/2,
  scanR: 168, scanHalf: 0.62, target: null, retargetT: 0,
  catchR: 26, px: 0, py: 0, lock: 0, stuckT: 0, lastx: 0, lasty: 0,
};

// ---------- game state ----------
let agents = [], player = null;
let timeLeft = 90, suspicion = 0, running = false;
let shake = 0, particles = [];
let glitchCooldown = 6, lastTimerInt = 90;
let stats = { closest: 0, glitchHit: 0, glitchTotal: 0, botsOut: 0 };
let killcam = null;      // {x, y, t, dur, won}

const NPC_COUNT = 33;
const N_BOTS = 3;        // dumb-human AI hiders that slip

function placeFree(a) {
  let tries = 0;
  while (insidePillar(a.x, a.y) && tries++ < 20) {
    a.x = rand(ARENA.x+30, ARENA.x+ARENA.w-30);
    a.y = rand(ARENA.y+30, ARENA.y+ARENA.h-30);
  }
}
function spawn() {
  agents = [];
  for (let i = 0; i < NPC_COUNT; i++) { const a = makeAgent(false); placeFree(a); agents.push(a); }
  for (let i = 0; i < N_BOTS; i++) { const a = makeAgent(false); a.botHider = true; placeFree(a); agents.push(a); }
  player = makeAgent(true);
  player.x = ARENA.x + ARENA.w/2; player.y = ARENA.y + ARENA.h - 55;
  agents.push(player);

  hunter.x = W/2; hunter.y = ARENA.y + 28; hunter.facing = Math.PI/2;
  hunter.target = null; hunter.retargetT = 0; hunter.lock = 0;
  hunter.stuckT = 0; hunter.lastx = hunter.x; hunter.lasty = hunter.y;

  timeLeft = 90; suspicion = 0; running = true; shake = 0;
  particles = []; currentGlitch = null; glitchCooldown = 6; lastTimerInt = 90;
  stats = { closest: 0, glitchHit: 0, glitchTotal: 0, botsOut: 0 };
  killcam = null;
  elGlitch.style.opacity = "0";
}
function insidePillar(x, y) {
  for (const p of PILLARS) if (x > p.x-BODY_R && x < p.x+p.w+BODY_R && y > p.y-BODY_R && y < p.y+p.h+BODY_R) return true;
  return false;
}

// ---------- player ----------
function updatePlayer(dt) {
  player.animPhase += dt;
  let ix = 0, iy = 0;
  if (keys["a"] || keys["arrowleft"])  ix -= 1;
  if (keys["d"] || keys["arrowright"]) ix += 1;
  if (keys["w"] || keys["arrowup"])    iy -= 1;
  if (keys["s"] || keys["arrowdown"])  iy += 1;
  const slow = keys["shift"];
  const spd = slow ? NPC_SPEED : PLAYER_SPEED;

  if (ix || iy) {
    const d = Math.hypot(ix, iy);
    player.vx = ix/d*spd; player.vy = iy/d*spd;
    player.facing = lerpAngle(player.facing, Math.atan2(iy, ix), 0.3);
    player.pose = POSE.WALK;
  } else {
    player.vx = 0; player.vy = 0;
    // hold F to dance, else idle
    if (keys["f"]) { player.pose = POSE.DANCE; player.dancePhase += dt*8; }
    else player.pose = POSE.IDLE;
  }

  player.x = clamp(player.x + player.vx*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
  player.y = clamp(player.y + player.vy*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  collidePillars(player);

  if (currentGlitch && !player.reacted && (keys[" "] || keys["e"])) {
    player.reacted = true;
    player.reacting = true; player.reactT = Math.max(0.2, currentGlitch.t);
    if (currentGlitch.t > currentGlitch.t0 - currentGlitch.window) { stats.glitchHit++; }
    beep(680, 0.08, "triangle", 0.05);
  }
}

// ---------- suspicion ----------
function neighborStats(a, radius) {
  let sumSpeed = 0, n = 0, poses = { idle:0, walk:0, dance:0 };
  for (const o of agents) {
    if (o === a || o.isPlayer) continue;
    if (dist(a.x, a.y, o.x, o.y) < radius) {
      sumSpeed += Math.hypot(o.vx, o.vy); n++;
      poses[o.pose] = (poses[o.pose]||0) + 1;
    }
  }
  let maj = "idle", mc = -1;
  for (const k in poses) if (poses[k] > mc) { mc = poses[k]; maj = k; }
  return { avgSpeed: n ? sumSpeed/n : 0, n, majority: maj, majCount: mc };
}

function inCone(hx, hy, facing, half, range, tx, ty) {
  const dx = tx-hx, dy = ty-hy, d = Math.hypot(dx, dy);
  if (d > range) return false;
  let ang = Math.atan2(dy, dx) - facing;
  while (ang > Math.PI) ang -= Math.PI*2; while (ang < -Math.PI) ang += Math.PI*2;
  return Math.abs(ang) < half;
}
function playerVisible() {
  return inCone(hunter.x, hunter.y, hunter.facing, hunter.scanHalf, hunter.scanR, player.x, player.y)
      && !losBlocked(hunter.x, hunter.y, player.x, player.y);
}

function humanScore(a) {
  // higher = looks more human. used by hunter + suspicion alike (behavior only)
  const ns = neighborStats(a, 95);
  const sp = Math.hypot(a.vx, a.vy);
  let s = 0;
  s += Math.abs(sp - ns.avgSpeed) * 0.16;            // speed mismatch
  if (sp > NPC_SPEED + 6) s += (sp - NPC_SPEED) * 0.22; // panic sprint
  if (ns.n >= 3 && a.pose !== ns.majority) s += 10;   // wrong pose vs crowd
  if (currentGlitch && a.reacting === false && a.reacted === false) s += 14; // ignoring glitch
  return s;
}

function updateSuspicion(dt) {
  const seen = playerVisible();
  let rate = 0;
  if (seen) {
    rate += humanScore(player);
    rate += 5; // base inspection pressure
  }
  if (rate < 4) rate -= 13; // blending → cool down
  suspicion = clamp(suspicion + rate*dt, 0, 100);
  if (suspicion > stats.closest) stats.closest = suspicion;
  if (suspicion >= 100 && running) endGame(false, "suspicion");
}

// ---------- hunter AI ----------
function updateHunter(dt) {
  hunter.retargetT -= dt;
  if (hunter.retargetT <= 0) {
    hunter.retargetT = 0.4;
    let best = null, bestScore = 18;
    for (const a of agents) {
      if (!inCone(hunter.x, hunter.y, hunter.facing, hunter.scanHalf, hunter.scanR, a.x, a.y)) continue;
      if (losBlocked(hunter.x, hunter.y, a.x, a.y)) continue;
      const s = humanScore(a);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    hunter.target = best;
  }

  // lock builds when target is the real player & visible
  if (hunter.target === player && playerVisible()) {
    hunter.lock = clamp(hunter.lock + dt*0.9, 0, 1);
  } else {
    hunter.lock = clamp(hunter.lock - dt*0.7, 0, 1);
  }

  // drop a target we can no longer see (it ducked behind cover)
  if (hunter.target && losBlocked(hunter.x, hunter.y, hunter.target.x, hunter.target.y)) hunter.target = null;

  let tx, ty;
  if (hunter.target) { tx = hunter.target.x; ty = hunter.target.y; }
  else {
    if (!hunter.px || dist(hunter.x,hunter.y,hunter.px,hunter.py) < 30) {
      const fp = freePoint(BODY_R + 14); hunter.px = fp.x; hunter.py = fp.y;
    }
    tx = hunter.px; ty = hunter.py;
  }
  const dx = tx-hunter.x, dy = ty-hunter.y, d = Math.hypot(dx,dy)||1;
  const hSpeed = hunter.target ? 118 : 82;
  hunter.x = clamp(hunter.x + dx/d*hSpeed*dt, ARENA.x+BODY_R, ARENA.x+ARENA.w-BODY_R);
  hunter.y = clamp(hunter.y + dy/d*hSpeed*dt, ARENA.y+BODY_R, ARENA.y+ARENA.h-BODY_R);
  collidePillars(hunter);
  hunter.facing = lerpAngle(hunter.facing, Math.atan2(dy,dx), 3.2*dt);

  // anti-stuck: if pinned against cover, abandon target & pick a fresh free patrol point
  const moved = dist(hunter.x, hunter.y, hunter.lastx, hunter.lasty);
  hunter.lastx = hunter.x; hunter.lasty = hunter.y;
  if (moved < hSpeed*dt*0.35) hunter.stuckT += dt; else hunter.stuckT = 0;
  if (hunter.stuckT > 0.7) {
    hunter.target = null;
    const fp = freePoint(BODY_R + 14); hunter.px = fp.x; hunter.py = fp.y;
    hunter.stuckT = 0;
  }

  // catch the real player: needs lock + proximity (fair warning via lock ring)
  if (hunter.target === player && hunter.lock > 0.55 && dist(hunter.x,hunter.y,player.x,player.y) < hunter.catchR) {
    endGame(false, "caught");
    return;
  }
  // catch a dumb-human bot: instant pop, NOT game over — takes heat off the player
  if (hunter.target && hunter.target.botHider && dist(hunter.x,hunter.y,hunter.target.x,hunter.target.y) < hunter.catchR) {
    eliminateBot(hunter.target);
  }
}

function eliminateBot(bot) {
  const i = agents.indexOf(bot);
  if (i >= 0) agents.splice(i, 1);
  burst(bot.x, bot.y, "#ff2e63", 22);
  stats.botsOut++;
  hunter.target = null; hunter.lock = 0; shake = Math.max(shake, 8);
  beep(160, 0.1, "square", 0.06); setTimeout(()=>beep(110,0.18,"sawtooth",0.05), 90);
}

// ---------- glitch events ----------
const GLITCHES = [
  { type: "alarm",  name: "🚨 FIRE ALARM",   sub: "SPACE — run for an exit!",   window: 1.5, t: 2.4 },
  { type: "cash",   name: "💸 CASH DROPPED",  sub: "SPACE — rush the center!",   window: 1.5, t: 2.2 },
  { type: "freeze", name: "🧊 SYSTEM FREEZE", sub: "SPACE — hold perfectly still!", window: 1.5, t: 1.9 },
];
function triggerGlitch() {
  const g = { ...GLITCHES[(Math.random()*GLITCHES.length)|0] };
  g.t0 = g.t;
  currentGlitch = g;
  stats.glitchTotal++;
  for (const a of agents) {
    if (a.isPlayer) { a.reacted = false; a.reacting = false; continue; }
    // dumb-human bots flub the reaction ~45% of the time → they get spotted
    if (a.botHider && Math.random() < 0.45) { a.reacting = false; a.reacted = false; continue; }
    a.reacting = true; a.reactT = g.t;
  }
  player.reacted = false; player.reacting = false;
  elGlitch.innerHTML = g.name + "<small>" + g.sub + "</small>";
  elGlitch.style.opacity = "1";
  beep(170, 0.25, "sawtooth", 0.08);
  shake = Math.max(shake, 7);
}
function clearGlitch() { currentGlitch = null; elGlitch.style.opacity = "0"; }

// ---------- particles ----------
function burst(x, y, color, n = 18) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI*2), s = rand(40, 230);
    particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: rand(.4,.95), color });
  }
}

// ---------- end ----------
let pendingEnd = null;   // {won, reason, survived}
function endGame(won, reason) {
  if (!running) return;
  running = false;
  hunter.lock = 0;
  elVignette.style.opacity = "0";
  const survived = Math.max(0, Math.ceil(90 - timeLeft));
  pendingEnd = { won, reason, survived };

  if (won) {
    showEndScreen();   // no kill-cam on a win
  } else {
    // KILL-CAM: freeze, zoom on the busted body, slow-mo, then reveal the verdict
    killcam = { x: player.x, y: player.y, t: 0, dur: 2.4, won: false };
    burst(player.x, player.y, "#ff2e63", 40);
    shake = 18;
    beep(220,0.12,"sawtooth"); setTimeout(()=>beep(140,0.25,"sawtooth"),120);
  }
}
function showEndScreen() {
  if (!pendingEnd) return;
  const { won, reason, survived } = pendingEnd;
  killcam = null;
  endScreen.classList.remove("hidden", "win", "lose");
  elStats.innerHTML =
    `<span><b>${Math.min(90, Math.round(90 - timeLeft))}s</b>survived</span>` +
    `<span><b>${Math.round(stats.closest)}%</b>closest call</span>` +
    `<span><b>${stats.glitchHit}/${stats.glitchTotal}</b>glitches nailed</span>` +
    `<span><b>${stats.botsOut}</b>bots busted</span>`;
  if (won) {
    endScreen.classList.add("win");
    endTitle.textContent = "SURVIVED";
    endSub.textContent = "You out-faked the AI.";
    endFlavor.textContent = "90 seconds blended. The Hunter never locked you. That's the clip.";
    beep(523,0.1,"triangle"); setTimeout(()=>beep(784,0.18,"triangle"),110);
  } else {
    endScreen.classList.add("lose");
    endTitle.textContent = "CAUGHT";
    endSub.textContent = reason === "suspicion"
      ? "Suspicion maxed — too human." : "Hunter locked you at " + survived + "s.";
    endFlavor.textContent = "You flinched, sprinted, or fumbled a glitch. Every caught human is a punchline.";
  }
  pendingEnd = null;
}

// ---------- drawing ----------
function drawPerson(a, isHunter) {
  const moving = Math.hypot(a.vx, a.vy) > 4;
  const dancing = a.pose === POSE.DANCE;
  const t = a.animPhase;
  const bodyCol = isHunter ? (hunter.target===player ? "#ff2e63" : "#3aa0ff") : SKIN;
  const headCol = isHunter ? "#cfe6ff" : SKIN_HEAD;

  ctx.save();
  ctx.translate(a.x, a.y);

  // shadow
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.beginPath(); ctx.ellipse(0, 11, 9, 3.2, 0, 0, Math.PI*2); ctx.fill();

  // legs (swing when walking)
  const swing = moving ? Math.sin(t*11)*4 : 0;
  ctx.strokeStyle = SKIN_DARK; ctx.lineWidth = 3.2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-2.5, 4); ctx.lineTo(-2.5 + swing*0.4, 11); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( 2.5, 4); ctx.lineTo( 2.5 - swing*0.4, 11); ctx.stroke();

  // torso
  const bob = dancing ? Math.sin(a.dancePhase)*1.6 : (moving ? Math.abs(Math.sin(t*11))*0.8 : Math.sin(t*2)*0.5);
  ctx.fillStyle = bodyCol;
  roundRect(-5, -6 + bob, 10, 12, 4); ctx.fill();

  // arms (up when dancing)
  ctx.strokeStyle = bodyCol; ctx.lineWidth = 3;
  if (dancing) {
    const w = Math.sin(a.dancePhase*1.5)*0.5;
    ctx.beginPath(); ctx.moveTo(-4,-3+bob); ctx.lineTo(-8, -9 + w*3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( 4,-3+bob); ctx.lineTo( 8, -9 - w*3); ctx.stroke();
  } else if (moving) {
    const s2 = Math.sin(t*11)*3;
    ctx.beginPath(); ctx.moveTo(-4,-2+bob); ctx.lineTo(-5, 3 + s2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( 4,-2+bob); ctx.lineTo( 5, 3 - s2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(-4,-2+bob); ctx.lineTo(-5, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( 4,-2+bob); ctx.lineTo( 5, 3); ctx.stroke();
  }

  // head
  ctx.fillStyle = headCol;
  ctx.beginPath(); ctx.arc(0, -10 + bob, 5, 0, Math.PI*2); ctx.fill();

  // hunter visor
  if (isHunter) {
    ctx.fillStyle = "rgba(10,20,35,.9)";
    ctx.save(); ctx.translate(0, -10+bob); ctx.rotate(a.facing);
    roundRect(1, -2.4, 4.5, 4.8, 1.5); ctx.fill(); ctx.restore();
  }

  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

function draw() {
  ctx.clearRect(0,0,W,H);
  ctx.save();
  if (shake > 0.2) ctx.translate(rand(-shake,shake), rand(-shake,shake));

  // KILL-CAM zoom: ease into a close-up centered on the busted body
  if (killcam) {
    const e = clamp(killcam.t / 0.5, 0, 1);
    const ez = 1 - Math.pow(1 - e, 3);     // easeOutCubic
    const zoom = 1 + 1.6 * ez;
    ctx.translate(W/2, H/2);
    ctx.scale(zoom, zoom);
    ctx.translate(-killcam.x, -killcam.y);
  }

  // floor
  ctx.fillStyle = "#0e1422";
  ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  ctx.strokeStyle = "#172033"; ctx.lineWidth = 1;
  for (let gx = ARENA.x; gx <= ARENA.x+ARENA.w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx,ARENA.y); ctx.lineTo(gx,ARENA.y+ARENA.h); ctx.stroke(); }
  for (let gy = ARENA.y; gy <= ARENA.y+ARENA.h; gy += 40) { ctx.beginPath(); ctx.moveTo(ARENA.x,gy); ctx.lineTo(ARENA.x+ARENA.w,gy); ctx.stroke(); }

  // glitch focal
  if (currentGlitch) {
    if (currentGlitch.type === "cash") {
      ctx.fillStyle = "rgba(245,185,66,.18)";
      ctx.beginPath(); ctx.arc(W/2, ARENA.y+ARENA.h/2, 42, 0, Math.PI*2); ctx.fill();
    } else if (currentGlitch.type === "alarm") {
      ctx.fillStyle = "rgba(255,46,99,.10)";
      ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    }
  }

  // hunter cone
  ctx.save();
  ctx.translate(hunter.x, hunter.y); ctx.rotate(hunter.facing);
  const grd = ctx.createRadialGradient(0,0,10,0,0,hunter.scanR);
  const hot = hunter.target ? "rgba(255,46,99,0.26)" : "rgba(58,160,255,0.16)";
  grd.addColorStop(0, hot); grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,hunter.scanR,-hunter.scanHalf,hunter.scanHalf); ctx.closePath(); ctx.fill();
  ctx.restore();

  // pillars
  for (const p of PILLARS) {
    ctx.fillStyle = "#1c2942";
    roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill();
    ctx.strokeStyle = "#2c3e5e"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.04)";
    roundRect(p.x+3, p.y+3, p.w-6, 6, 3); ctx.fill();
  }

  // arena border
  ctx.strokeStyle = "#243149"; ctx.lineWidth = 2;
  ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

  // bodies — sort by y for fake depth
  const drawn = agents.filter(a => !a.isPlayer).slice().sort((p,q)=>p.y-q.y);
  for (const a of drawn) drawPerson(a, false);

  if (player) {
    drawPerson(player, false);
    // YOU marker
    ctx.beginPath(); ctx.strokeStyle = "rgba(43,212,121,.9)"; ctx.lineWidth = 2;
    ctx.arc(player.x, player.y, BODY_R+7, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = "rgba(43,212,121,.95)"; ctx.font = "bold 10px Segoe UI"; ctx.textAlign = "center";
    ctx.fillText("YOU", player.x, player.y - BODY_R - 16);

    // lock ring when hunter onto you
    if (hunter.lock > 0.02) {
      ctx.beginPath(); ctx.strokeStyle = "rgba(255,46,99,.9)"; ctx.lineWidth = 3;
      ctx.arc(player.x, player.y, BODY_R+12, -Math.PI/2, -Math.PI/2 + Math.PI*2*hunter.lock);
      ctx.stroke();
    }
  }

  // hunter
  drawPerson(hunter, true);
  ctx.fillStyle = hunter.target ? "#ff2e63" : "#3aa0ff"; ctx.font = "bold 10px Segoe UI"; ctx.textAlign = "center";
  ctx.fillText("HUNTER", hunter.x, hunter.y - BODY_R - 16);

  // particles
  for (const p of particles) { ctx.globalAlpha = clamp(p.life,0,1); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }
  ctx.globalAlpha = 1;

  // kill-cam highlight ring on the busted body (world space, inside zoom)
  if (killcam) {
    const pulse = 2 + Math.sin(killcam.t*12)*1.2;
    ctx.beginPath(); ctx.strokeStyle = "rgba(255,46,99,.95)"; ctx.lineWidth = pulse;
    ctx.arc(killcam.x, killcam.y, BODY_R+6, 0, Math.PI*2); ctx.stroke();
  }

  ctx.restore();

  // kill-cam stamp (screen space, on top of everything)
  if (killcam && killcam.t > 0.45) {
    const a = clamp((killcam.t-0.45)/0.3, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff2e63";
    ctx.font = "900 64px Segoe UI";
    ctx.fillText("HUMAN ERROR", W/2, H/2 - 8);
    ctx.fillStyle = "#e8edf5";
    ctx.font = "700 20px Segoe UI";
    ctx.fillText("CAUGHT — too human.", W/2, H/2 + 30);
    ctx.restore();
  }
}

// ---------- loop ----------
let last = 0;
function frame(ts) {
  try { tick(ts); }
  catch (err) { console.error("HUMAN ERROR loop fault:", err); }
  requestAnimationFrame(frame);
}
function tick(ts) {
  const dt = Math.min(0.05, (ts - last)/1000 || 0);
  last = ts;

  if (running) {
    timeLeft -= dt;
    const ti = Math.ceil(timeLeft);
    if (ti !== lastTimerInt && ti >= 0) {
      lastTimerInt = ti; elTimer.textContent = ti;
      if (ti <= 10 && ti > 0) beep(440 + (10-ti)*40, 0.05, "square", 0.04);
    }
    if (timeLeft <= 0) { timeLeft = 0; endGame(true); }

    if (!currentGlitch) {
      glitchCooldown -= dt;
      if (glitchCooldown <= 0) triggerGlitch();
    } else {
      currentGlitch.t -= dt;
      if (currentGlitch.t <= 0) { clearGlitch(); glitchCooldown = rand(7, 12); }
    }

    updatePlayer(dt);
    for (const a of agents) {
      if (a.isPlayer) continue;
      if (a.botHider) updateBot(a, dt); else updateNPC(a, dt);
    }
    if (player.reacting) { player.reactT -= dt; runReaction(player, dt); collidePillars(player); if (player.reactT <= 0) player.reacting = false; }
    updateHunter(dt);
    updateSuspicion(dt);

    elSusp.style.width = suspicion.toFixed(1) + "%";

    // vignette + heartbeat when hunted
    const heat = Math.max(suspicion/100*0.6, hunter.lock);
    elVignette.style.opacity = (heat*0.9).toFixed(2);
    if (heat > 0.4) {
      heartT -= dt;
      if (heartT <= 0) { heartT = clamp(0.7 - heat*0.4, 0.18, 0.7); beep(60, 0.12, "sine", 0.05*heat); }
    }
  }

  // kill-cam runs in slow-mo after a catch, then reveals the verdict screen
  if (killcam) {
    killcam.t += dt * 0.45;
    if (killcam.t >= killcam.dur) showEndScreen();
  }

  for (const p of particles) { p.x += p.vx*dt; p.y += p.vy*dt; p.vx*=0.92; p.vy*=0.92; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  shake *= 0.86;

  draw();
}

// ---------- start ----------
function start() {
  if (!actx) { try { actx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){} }
  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  spawn();
}
document.getElementById("startBtn").addEventListener("click", start);
document.getElementById("againBtn").addEventListener("click", start);
addEventListener("keydown", e => {
  if (e.key === "Enter") {
    if (!startScreen.classList.contains("hidden") || !endScreen.classList.contains("hidden")) start();
  }
});

requestAnimationFrame(frame);
})();
