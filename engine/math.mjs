// ============================================================
// HUMAN ERROR — shared math + seeded RNG
// Pure, environment-agnostic. Imported by browser (solo + mp client)
// and Node (authoritative server).
// ============================================================

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
export function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// Mulberry32 — small, fast, deterministic 32-bit PRNG.
// Deterministic streams matter for netcode (server/client agreement) and replays.
export function makeRNG(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length) | 0],
    chance: (p) => next() < p,
    angle: () => next() * TAU,
    // re-seed in place (used when a match restarts on a fresh seed)
    reseed: (n) => { s = (n >>> 0) || 1; },
  };
}

// Hash a string to a 32-bit seed (room codes -> deterministic match seed).
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
