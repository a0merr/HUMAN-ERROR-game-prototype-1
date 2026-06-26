// ============================================================
// HUMAN ERROR — AI Hunter
// Scans on behavior only (never identity). Locks the most "human"-looking
// body in line of sight, creeps in to inspect, and emits catch events that
// the mode-specific rules layer resolves.
// ============================================================

import { ARENA, BODY_R, TUNING } from './config.mjs';
import { clamp, dist, lerpAngle } from './math.mjs';
import { collidePillars, losBlocked, inCone, freePoint } from './geometry.mjs';
import { humanScore } from './agents.mjs';

export function makeHunter(i, total, rng, wave = 1) {
  const fx = ARENA.x + ARENA.w * ((i + 1) / (total + 1));
  return {
    kind: 'ai-hunter', role: 'hunter',
    x: fx, y: ARENA.y + 28, vx: 0, vy: 0, facing: Math.PI / 2,
    scanR: 150 + wave * 8, scanHalf: 0.62, target: null, retargetT: rng.range(0, 0.4),
    catchR: TUNING.catchR, px: 0, py: 0, lock: 0, stuckT: 0,
    lastx: fx, lasty: ARENA.y + 28, inspect: 0,
  };
}

export function seesAgent(h, a, pillars) {
  return inCone(h.x, h.y, h.facing, h.scanHalf, h.scanR, a.x, a.y) && !losBlocked(h.x, h.y, a.x, a.y, pillars);
}

export function updateHunter(h, dt, ctx) {
  const { pillars, agents, decoys, rng, player } = ctx;

  h.retargetT -= dt;
  if (h.retargetT <= 0) {
    h.retargetT = 0.38;
    let best = null, bestScore = 16;
    for (const d of decoys) {
      if (inCone(h.x, h.y, h.facing, h.scanHalf, h.scanR, d.x, d.y) && !losBlocked(h.x, h.y, d.x, d.y, pillars)) {
        const ds = d.strong ? 140 : 80;
        if (ds > bestScore) { bestScore = ds; best = d; }
      }
    }
    for (const a of agents) {
      if (a.role === 'hunter' || !a.alive) continue;
      if (!seesAgent(h, a, pillars)) continue;
      const s = humanScore(a, ctx);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    h.target = best;
  }

  // The hunter builds a lock on whatever human hider it is tracking — the solo
  // local player OR (in multiplayer, where there's no single ctx.player) any
  // human-controlled hider body. Bots are caught on contact, not on lock.
  const lockTarget = h.target && (h.target === player || (h.target.isPlayer && h.target.role === 'hider'))
    ? h.target : null;
  const locking = lockTarget && seesAgent(h, lockTarget, pillars);
  if (locking) {
    const near = dist(h.x, h.y, lockTarget.x, lockTarget.y) < 90 ? 1.4 : 1;
    h.lock = clamp(h.lock + dt * ctx.lockSpeed * near, 0, 1);
    h.inspect = 1;
  } else {
    h.lock = clamp(h.lock - dt * 0.7, 0, 1);
    h.inspect = Math.max(0, h.inspect - dt * 2);
  }

  if (h.target && h.target.x !== undefined && losBlocked(h.x, h.y, h.target.x, h.target.y, pillars) && !h.target.isDecoy) h.target = null;

  let tx, ty;
  if (h.target) { tx = h.target.x; ty = h.target.y; }
  else {
    if (!h.px || dist(h.x, h.y, h.px, h.py) < 30) { const fp = freePoint(pillars, rng, BODY_R + 14); h.px = fp.x; h.py = fp.y; }
    tx = h.px; ty = h.py;
  }
  const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy) || 1;
  const hSpeed = h.target ? (h.inspect > 0.3 && h.lock > 0.3 ? TUNING.hunterInspect : TUNING.hunterChase) : TUNING.hunterRoam;
  h.x = clamp(h.x + dx / d * hSpeed * dt, ARENA.x + BODY_R, ARENA.x + ARENA.w - BODY_R);
  h.y = clamp(h.y + dy / d * hSpeed * dt, ARENA.y + BODY_R, ARENA.y + ARENA.h - BODY_R);
  collidePillars(h, pillars);
  h.facing = lerpAngle(h.facing, Math.atan2(dy, dx), 3.2 * dt);

  const moved = dist(h.x, h.y, h.lastx, h.lasty); h.lastx = h.x; h.lasty = h.y;
  if (moved < hSpeed * dt * 0.35) h.stuckT += dt; else h.stuckT = 0;
  if (h.stuckT > 0.7) { h.target = null; const fp = freePoint(pillars, rng, BODY_R + 14); h.px = fp.x; h.py = fp.y; h.stuckT = 0; }

  // emit catch events; the rules layer decides consequences
  if (lockTarget && h.lock > 0.55 && dist(h.x, h.y, lockTarget.x, lockTarget.y) < h.catchR) {
    // solo's local player vs. a multiplayer human hider — distinct events so each
    // mode's rules layer resolves it correctly (suspicion end vs. body removal).
    if (lockTarget === player) ctx.events.push({ type: 'catchPlayer', hunter: h });
    else ctx.events.push({ type: 'catchHider', agent: lockTarget, hunter: h });
  }
  if (h.target && h.target.botHider && h.target.alive !== false && dist(h.x, h.y, h.target.x, h.target.y) < h.catchR) {
    ctx.events.push({ type: 'popBot', agent: h.target, hunter: h });
  }
  if (h.target && h.target.isDecoy && dist(h.x, h.y, h.target.x, h.target.y) < h.catchR) {
    ctx.events.push({ type: 'popDecoy', decoy: h.target, hunter: h });
  }
}

export function maxPlayerLock(hunters, player) {
  let m = 0;
  for (const h of hunters) if (h.target === player) m = Math.max(m, h.lock);
  return m;
}
