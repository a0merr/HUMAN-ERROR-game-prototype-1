// ============================================================
// HUMAN ERROR — collision, line-of-sight, vision cones, spawning
// Map-driven: every function takes the active pillar set, so solo and
// multiplayer (any map) share one implementation.
// ============================================================

import { ARENA, BODY_R } from './config.mjs';
import { clamp } from './math.mjs';

// Push an agent (or {x,y}) out of any pillar it overlaps.
export function collidePillars(a, pillars) {
  for (const p of pillars) {
    const cx = clamp(a.x, p.x, p.x + p.w), cy = clamp(a.y, p.y, p.y + p.h);
    const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy);
    if (d < BODY_R && d > 0.0001) { a.x = cx + dx / d * BODY_R; a.y = cy + dy / d * BODY_R; }
    else if (d <= 0.0001) { a.x = p.x - BODY_R; }
  }
}

// Keep an agent inside the arena bounds.
export function clampArena(a) {
  a.x = clamp(a.x, ARENA.x + BODY_R, ARENA.x + ARENA.w - BODY_R);
  a.y = clamp(a.y, ARENA.y + BODY_R, ARENA.y + ARENA.h - BODY_R);
}

// Sampled segment test against pillar rects.
export function losBlocked(x0, y0, x1, y1, pillars) {
  const steps = 24;
  for (let i = 1; i < steps; i++) {
    const t = i / steps, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
    for (const p of pillars) if (px > p.x && px < p.x + p.w && py > p.y && py < p.y + p.h) return true;
  }
  return false;
}

export function insidePillar(x, y, pillars) {
  for (const p of pillars)
    if (x > p.x - BODY_R && x < p.x + p.w + BODY_R && y > p.y - BODY_R && y < p.y + p.h + BODY_R) return true;
  return false;
}

// Vision cone membership.
export function inCone(hx, hy, facing, half, range, tx, ty) {
  const dx = tx - hx, dy = ty - hy, d = Math.hypot(dx, dy);
  if (d > range) return false;
  let ang = Math.atan2(dy, dx) - facing;
  while (ang > Math.PI) ang -= Math.PI * 2;
  while (ang < -Math.PI) ang += Math.PI * 2;
  return Math.abs(ang) < half;
}

// Random free spawn point not overlapping cover. Uses an injected rng so
// spawns are deterministic per match seed.
export function freePoint(pillars, rng, margin) {
  margin = margin || (BODY_R + 8);
  for (let i = 0; i < 30; i++) {
    const x = rng.range(ARENA.x + 25, ARENA.x + ARENA.w - 25);
    const y = rng.range(ARENA.y + 25, ARENA.y + ARENA.h - 25);
    let ok = true;
    for (const p of pillars)
      if (x > p.x - margin && x < p.x + p.w + margin && y > p.y - margin && y < p.y + p.h + margin) { ok = false; break; }
    if (ok) return { x, y };
  }
  return { x: rng.range(ARENA.x + 25, ARENA.x + ARENA.w - 25), y: rng.range(ARENA.y + 25, ARENA.y + ARENA.h - 25) };
}

// Nudge a point off cover if it spawned inside one.
export function placeFree(a, pillars, rng) {
  let t = 0;
  while (insidePillar(a.x, a.y, pillars) && t++ < 20) {
    a.x = rng.range(ARENA.x + 30, ARENA.x + ARENA.w - 30);
    a.y = rng.range(ARENA.y + 30, ARENA.y + ARENA.h - 30);
  }
}
