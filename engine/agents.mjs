// ============================================================
// HUMAN ERROR — agents: NPC routines, dumb-human bot "slips",
// glitch reactions, and the behavioral "humanness" score.
// All functions take a sim context { pillars, rng, agents, hunters, glitch }.
// ============================================================

import { ARENA, BODY_R, POSE, KIND, TUNING } from './config.mjs';
import { clamp, dist, lerpAngle } from './math.mjs';
import { collidePillars, clampArena, freePoint } from './geometry.mjs';

let _id = 0;
export function resetIds() { _id = 0; }

export function makeAgent(rng, kind = KIND.NPC) {
  return {
    id: ++_id, kind,
    isPlayer: false, role: null,           // role: 'hider' | 'hunter' for humans
    x: rng.range(ARENA.x + 30, ARENA.x + ARENA.w - 30),
    y: rng.range(ARENA.y + 30, ARENA.y + ARENA.h - 30),
    vx: 0, vy: 0, pose: POSE.IDLE, state: POSE.IDLE,
    timer: rng.range(0.5, 2.5), wpx: 0, wpy: 0,
    dancePhase: rng.angle(), animPhase: rng.angle(), facing: rng.angle(),
    reacting: false, reactT: 0, reacted: false,
    slipT: rng.range(2.5, 6), slipping: false, slip: '', slipDur: 0, sdx: 0, sdy: 0,
    skin: 0, taunt: 0, tauntT: 0, alive: true,
  };
}

function newWaypoint(a, ctx) {
  const p = freePoint(ctx.pillars, ctx.rng);
  a.wpx = p.x; a.wpy = p.y;
}

// Core NPC looping routine: idle / walk-to-waypoint / dance.
export function updateNPC(a, dt, ctx) {
  a.animPhase += dt; a.timer -= dt;
  if (a.reacting) {
    a.reactT -= dt; runReaction(a, dt, ctx);
    if (a.reactT <= 0) { a.reacting = false; a.state = POSE.IDLE; a.timer = ctx.rng.range(0.6, 1.6); }
    a.pose = a.state; collidePillars(a, ctx.pillars); return;
  }
  if (a.timer <= 0) {
    const r = ctx.rng.next();
    if (r < 0.42) { a.state = POSE.IDLE; a.timer = ctx.rng.range(1.2, 3.0); }
    else if (r < 0.78) { a.state = POSE.WALK; newWaypoint(a, ctx); a.timer = ctx.rng.range(2.0, 4.0); }
    else { a.state = POSE.DANCE; a.timer = ctx.rng.range(1.6, 3.6); }
  }
  if (a.state === POSE.IDLE) { a.vx = 0; a.vy = 0; }
  else if (a.state === POSE.WALK) {
    const dx = a.wpx - a.x, dy = a.wpy - a.y, d = Math.hypot(dx, dy);
    if (d < 6) { a.state = POSE.IDLE; a.timer = ctx.rng.range(0.6, 1.8); a.vx = a.vy = 0; }
    else { a.vx = dx / d * TUNING.npcSpeed; a.vy = dy / d * TUNING.npcSpeed; a.facing = lerpAngle(a.facing, Math.atan2(dy, dx), 0.2); }
  } else if (a.state === POSE.DANCE) {
    a.dancePhase += dt * 8;
    a.vx = Math.cos(a.dancePhase) * TUNING.danceDrift;
    a.vy = Math.sin(a.dancePhase * 1.3) * TUNING.danceDrift;
  }
  a.x += a.vx * dt; a.y += a.vy * dt;
  clampArena(a); collidePillars(a, ctx.pillars); a.pose = a.state;
}

// ---- dumb-human bots: NPCs that periodically "slip" like a panicking human ----
const SLIPS = ['sprint', 'flinch', 'overdance', 'bunch'];

function startSlip(a, ctx) {
  a.slipping = true; a.slip = ctx.rng.pick(SLIPS); a.slipDur = ctx.rng.range(0.5, 1.1);
  const ang = ctx.rng.angle(); a.sdx = Math.cos(ang); a.sdy = Math.sin(ang);
}

function doSlip(a, dt, ctx) {
  const T = TUNING;
  if (a.slip === 'sprint') {
    a.pose = POSE.WALK; a.x += a.sdx * T.slipSprint * dt; a.y += a.sdy * T.slipSprint * dt;
    a.facing = Math.atan2(a.sdy, a.sdx);
  } else if (a.slip === 'flinch') {
    let nx = 0, ny = 0, best = 1e9;
    for (const h of ctx.hunters) { const d = dist(a.x, a.y, h.x, h.y); if (d < best) { best = d; nx = a.x - h.x; ny = a.y - h.y; } }
    const d = Math.hypot(nx, ny) || 1; a.pose = POSE.WALK;
    a.x += nx / d * T.slipFlinch * dt; a.y += ny / d * T.slipFlinch * dt;
  } else if (a.slip === 'overdance') {
    a.pose = POSE.DANCE; a.dancePhase += dt * 18; a.vx = a.vy = 0;
  } else if (a.slip === 'bunch') {
    a.pose = POSE.WALK; a.x += a.sdx * T.slipBunch * dt; a.y += a.sdy * T.slipBunch * dt;
  }
  clampArena(a);
}

export function updateBot(a, dt, ctx) {
  if (a.reacting) { updateNPC(a, dt, ctx); return; }
  if (!a.slipping) { a.slipT -= dt; if (a.slipT <= 0) startSlip(a, ctx); }
  if (a.slipping) {
    a.slipDur -= dt; a.animPhase += dt; doSlip(a, dt, ctx); collidePillars(a, ctx.pillars);
    if (a.slipDur <= 0) { a.slipping = false; a.slipT = ctx.rng.range(2.8, 6.5); }
    return;
  }
  updateNPC(a, dt, ctx);
}

// ---- forced glitch reactions (shared by NPCs, bots, and reacting humans) ----
export function runReaction(a, dt, ctx) {
  const g = ctx.glitch;
  if (!g) return;
  const A = ARENA;
  if (g.type === 'alarm') {
    const ex = a.x < A.x + A.w / 2 ? A.x + 24 : A.x + A.w - 24, ey = A.y + 24;
    const dx = ex - a.x, dy = ey - a.y, d = Math.hypot(dx, dy) || 1;
    a.x += dx / d * 135 * dt; a.y += dy / d * 135 * dt; a.facing = Math.atan2(dy, dx); a.state = POSE.WALK;
  } else if (g.type === 'cash') {
    const dx = A.x + A.w / 2 - a.x, dy = (A.y + A.h / 2) - a.y, d = Math.hypot(dx, dy) || 1;
    a.x += dx / d * 115 * dt; a.y += dy / d * 115 * dt; a.facing = Math.atan2(dy, dx); a.state = POSE.WALK;
  } else if (g.type === 'freeze') {
    a.vx = a.vy = 0; a.state = POSE.IDLE;
  } else if (g.type === 'wave') {
    a.state = POSE.DANCE; a.dancePhase += dt * 10; a.vx = a.vy = 0;
  }
  clampArena(a);
}

// ---- detection: how "human" an agent looks to a watcher ----
export function neighborStats(a, radius, agents) {
  let sum = 0, n = 0;
  const poses = { idle: 0, walk: 0, dance: 0 };
  for (const o of agents) {
    if (o === a || o.role === 'hunter') continue;
    if (dist(a.x, a.y, o.x, o.y) < radius) { sum += Math.hypot(o.vx, o.vy); n++; poses[o.pose] = (poses[o.pose] || 0) + 1; }
  }
  let maj = 'idle', mc = -1;
  for (const k in poses) if (poses[k] > mc) { mc = poses[k]; maj = k; }
  return { avgSpeed: n ? sum / n : 0, n, majority: maj };
}

// Behavioral "tell" score — never identity. Drives AI hunter targeting and
// the solo suspicion meter. Higher = more obviously human.
export function humanScore(a, ctx) {
  const ns = neighborStats(a, 95, ctx.agents);
  const sp = Math.hypot(a.vx, a.vy);
  let s = 0;
  s += Math.abs(sp - ns.avgSpeed) * 0.16;
  if (sp > TUNING.npcSpeed + 6) s += (sp - TUNING.npcSpeed) * 0.22;
  if (ns.n >= 3 && a.pose !== ns.majority) s += 10;
  if (ctx.glitch && a.reacting === false && a.reacted === false) s += 14;
  return s;
}
