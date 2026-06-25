// ============================================================
// HUMAN ERROR — CrowdSim
// The shared, DOM-free heart of the game. Owns the crowd (NPCs + dumb bots),
// glitch events, cover layout, and the deterministic RNG. Both the solo
// roguelite and the authoritative multiplayer server build their rules on
// top of this one class, so the crowd behaves identically everywhere.
// ============================================================

import { ARENA, BODY_R, GLITCHES, WAVE, KIND, mapById } from './config.mjs';
import { makeRNG, clamp } from './math.mjs';
import { collidePillars, clampArena, placeFree } from './geometry.mjs';
import { makeAgent, updateNPC, updateBot, runReaction, resetIds } from './agents.mjs';

export class CrowdSim {
  constructor(opts = {}) {
    this.seed = opts.seed >>> 0 || 1;
    this.rng = makeRNG(this.seed);
    this.setMap(opts.mapId || 'plaza');
    this.npcCount = opts.npcCount ?? WAVE.npcCount;
    this.botCount = opts.botCount ?? WAVE.botCount;

    this.agents = [];     // npcs + bots + human hiders (everything non-AI-hunter)
    this.hunters = [];    // AI hunters (solo); empty in MP (human is the hunter, lives in agents)
    this.decoys = [];     // solo perk drops
    this.glitch = null;
    this.glitchCooldown = this.rng.range(4, 7);
    this.events = [];     // catch events emitted this step, drained by rules layer
    this.time = 0;
    this.lockSpeed = 0.83;
    this.player = null;    // solo: the local human hider
  }

  setMap(mapId) {
    this.map = mapById(mapId);
    this.pillars = this.map.pillars;
    this.skin = this.map.skin;
  }

  // Build the AI crowd. Humans are added separately via addHuman().
  buildCrowd() {
    resetIds();
    this.agents = [];
    const skinIdx = ['slate', 'sand', 'moss', 'rose', 'steel'].indexOf(this.skin);
    for (let i = 0; i < this.npcCount; i++) {
      const a = makeAgent(this.rng, KIND.NPC); a.skin = Math.max(0, skinIdx);
      placeFree(a, this.pillars, this.rng); this.agents.push(a);
    }
    for (let i = 0; i < this.botCount; i++) {
      const a = makeAgent(this.rng, KIND.BOT); a.botHider = true; a.skin = Math.max(0, skinIdx);
      placeFree(a, this.pillars, this.rng); this.agents.push(a);
    }
  }

  addHuman({ role = 'hider', x, y } = {}) {
    const a = makeAgent(this.rng, KIND.HUMAN);
    a.isPlayer = true; a.role = role;
    if (x !== undefined) a.x = x;
    if (y !== undefined) a.y = y;
    placeFree(a, this.pillars, this.rng);
    this.agents.push(a);
    return a;
  }

  removeAgent(a) {
    const i = this.agents.indexOf(a);
    if (i >= 0) this.agents.splice(i, 1);
    a.alive = false;
    for (const h of this.hunters) if (h.target === a) { h.target = null; h.lock = 0; }
  }

  // ---- glitch events ----
  triggerGlitch() {
    const g = { ...this.rng.pick(GLITCHES) }; g.t0 = g.t;
    this.glitch = g;
    for (const a of this.agents) {
      if (a.isPlayer) { a.reacted = false; a.reacting = false; continue; }
      if (a.botHider && this.rng.chance(0.45)) { a.reacting = false; a.reacted = false; continue; }
      a.reacting = true; a.reactT = g.t;
    }
    return g;
  }
  clearGlitch() { this.glitch = null; }

  stepGlitch(dt) {
    if (!this.glitch) {
      this.glitchCooldown -= dt;
      if (this.glitchCooldown <= 0) return this.triggerGlitch();
    } else {
      this.glitch.t -= dt;
      if (this.glitch.t <= 0) { this.clearGlitch(); this.glitchCooldown = this.rng.range(6, 11); }
    }
    return null;
  }

  // ---- per-step crowd advance (NPCs, bots, reacting humans) ----
  // Human movement is applied by the mode layer before this call.
  stepCrowd(dt) {
    this.time += dt;
    for (const a of this.agents) {
      if (a.isPlayer) {
        if (a.reacting) {
          a.reactT -= dt; runReaction(a, dt, this); collidePillars(a, this.pillars);
          if (a.reactT <= 0) a.reacting = false;
        }
        continue;
      }
      if (a.botHider) updateBot(a, dt, this); else updateNPC(a, dt, this);
    }
    // decoys decay
    for (const d of this.decoys) d.t -= dt;
    if (this.decoys.length) this.decoys = this.decoys.filter(d => d.t > 0);
  }

  // Apply a movement intent to a human agent (shared by solo + mp).
  // intent: { ix, iy, slow, dance, speed } (speed overrides walk speed)
  applyHumanIntent(a, dt, intent) {
    a.animPhase += dt;
    const ix = intent.ix || 0, iy = intent.iy || 0;
    if (ix || iy) {
      const d = Math.hypot(ix, iy) || 1;
      const spd = intent.speed || (intent.slow ? 58 : 140);
      a.vx = ix / d * spd; a.vy = iy / d * spd;
      a.facing = (function lerpAng(from, to, t) { let dd = to - from; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2; return from + dd * t; })(a.facing, Math.atan2(iy, ix), 0.3);
      a.pose = 'walk';
    } else {
      a.vx = 0; a.vy = 0;
      if (intent.dance) { a.pose = 'dance'; a.dancePhase += dt * 8; }
      else a.pose = 'idle';
    }
    a.x = clamp(a.x + a.vx * dt, ARENA.x + BODY_R, ARENA.x + ARENA.w - BODY_R);
    a.y = clamp(a.y + a.vy * dt, ARENA.y + BODY_R, ARENA.y + ARENA.h - BODY_R);
    collidePillars(a, this.pillars);
  }

  // Snapshot for network transmission / replay.
  snapshot() {
    return {
      t: this.time, mapId: this.map.id, glitch: this.glitch ? this.glitch.type : null,
      agents: this.agents.map(a => [a.id, Math.round(a.x), Math.round(a.y), a.facing.toFixed(2), a.pose[0], a.kind[0], a.role || '']),
    };
  }
}
