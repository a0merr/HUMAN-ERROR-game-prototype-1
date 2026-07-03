// ============================================================
// HUMAN ERROR — deterministic replay (record / re-simulate)
// The engine is fully deterministic (seeded Mulberry32, no Math.random), so a
// round is reproducible from a few KB: {seed, mapId, counts, input stream}.
//
// ReplayRecorder — collects per-tick human intents (delta-encoded: an agent's
//   input is only stored when it CHANGES) plus a sparse event log for the
//   things inputs alone can't express (solo ability one-shots; MP joins/cuts).
// ReplayPlayer  — rebuilds an identical CrowdSim and re-steps it with the
//   recorded inputs at the recorded dt (solo: 60fps fixed-step; MP: the
//   server's actual per-tick dts). Step order mirrors each mode's live loop
//   exactly — any divergence there breaks byte-identical re-simulation.
//
// DOM-free, zero-dep: runs in the browser (watch mode) and Node (tests).
// ============================================================

import { CrowdSim } from './sim.mjs';
import { makeHunter, updateHunter } from './hunter.mjs';
import { freePoint } from './geometry.mjs';

export const REPLAY_VERSION = 1;

export class ReplayRecorder {
  begin(meta) {
    // meta: { mode:'solo'|'mp', seed, mapId, npcCount, botCount, dt,
    //         solo?: {wave, hunters, lockSpeed, spawn:{x,y}},
    //         mp?:   {roster:[{id,role}...], ai} }
    this.meta = { v: REPLAY_VERSION, ...meta };
    this.frames = [];   // [tick, agentId, input] — only when input changed
    this.events = [];   // [tick, {k, ...}] — one-shots / joins / cuts, in order
    this.dts = null;    // per-tick dt array (only when ticks aren't fixed-step)
    this._last = Object.create(null);
    this._ticks = 0;
  }
  frame(tick, inputsByAgentId) {
    if (tick + 1 > this._ticks) this._ticks = tick + 1;
    for (const id in inputsByAgentId) {
      const s = JSON.stringify(inputsByAgentId[id]);
      if (this._last[id] !== s) { this._last[id] = s; this.frames.push([tick, +id, JSON.parse(s)]); }
    }
  }
  // Record the actual dt of a tick (MP: the server loop measures real elapsed
  // time). Solo's fixed step never calls this — meta.dt covers every tick.
  tickDt(tick, dt) {
    if (tick + 1 > this._ticks) this._ticks = tick + 1;
    if (!this.dts) this.dts = [];
    this.dts[tick] = dt;
  }
  event(tick, e) {
    if (tick + 1 > this._ticks) this._ticks = tick + 1;
    this.events.push([tick, e]);
  }
  end(outcome) {
    const out = { ...this.meta, ticks: this._ticks, frames: this.frames, events: this.events, outcome: outcome || null };
    if (this.dts) out.dts = this.dts;
    return out;
  }
}

export class ReplayPlayer {
  constructor(json) {
    if (!json || json.v !== REPLAY_VERSION) {
      throw new Error('replay version mismatch (got ' + (json && json.v) + ', engine ' + REPLAY_VERSION + ')');
    }
    this.data = json;
    this.tick = 0; this.done = false; this.caught = false;
    this.sim = new CrowdSim({ seed: json.seed, mapId: json.mapId, npcCount: json.npcCount, botCount: json.botCount });
    this._fi = 0; this._ei = 0;

    if (json.mode === 'solo') {
      // mirror solo beginWave(): lockSpeed BEFORE buildCrowd, then player, then hunters
      const s = json.solo;
      this.sim.lockSpeed = s.lockSpeed;
      this.sim.buildCrowd();
      this.player = this.sim.addHuman({ role: 'hider', x: s.spawn.x, y: s.spawn.y });
      this.sim.player = this.player;
      this.sim.hunters = [];
      for (let i = 0; i < s.hunters; i++) this.sim.hunters.push(makeHunter(i, s.hunters, this.sim.rng, s.wave));
      this._input = { ix: 0, iy: 0, slow: false, dance: false, speed: 140 };
    } else {
      // mirror server startMatch(): per player addHuman then freePoint, then AI
      this.sim.buildCrowd();
      this.byId = new Map();
      this.inputs = new Map();
      for (const r of json.mp.roster) this._join(r.id, r.role);
      this.aiHunters = [];
      for (let i = 0; i < (json.mp.ai || 0); i++) this._spawnAi();
      this.player = null;
    }
  }

  dtFor(tick) { return (this.data.dts && this.data.dts[tick] !== undefined) ? this.data.dts[tick] : this.data.dt; }

  _join(id, role) {
    const a = this.sim.addHuman({ role });
    a.id = id;
    const fp = freePoint(this.sim.pillars, this.sim.rng);
    a.x = fp.x; a.y = fp.y;
    this.byId.set(id, a);
    return a;
  }
  _spawnAi() {
    const h = makeHunter(this.aiHunters.length, 1, this.sim.rng, 3);
    h.id = 900000 + this.aiHunters.length;
    this.aiHunters.push(h);
  }
  _cut(id) {
    const a = this.byId ? this.byId.get(id) : null;
    const b = a || this.sim.agents.find(x => x.id === id);
    if (!b || b.alive === false) return;
    this.sim.removeAgent(b);
    if (this.aiHunters) for (const h of this.aiHunters) if (h.target === b) { h.target = null; h.lock = 0; }
  }

  _eventsAt(tick) {
    const out = [];
    const evs = this.data.events;
    while (this._ei < evs.length && evs[this._ei][0] === tick) out.push(evs[this._ei++][1]);
    return out;
  }
  _framesAt(tick, apply) {
    const fr = this.data.frames;
    while (this._fi < fr.length && fr[this._fi][0] === tick) { const [, id, inp] = fr[this._fi++]; apply(id, inp); }
  }

  // Advance one recorded tick. Returns false once the replay is exhausted.
  step() {
    if (this.done) return false;
    const t = this.tick, dt = this.dtFor(t), sim = this.sim;
    const evs = this._eventsAt(t);

    if (this.data.mode === 'solo') {
      // one-shots first — live they fired on keydown, before this tick stepped
      for (const e of evs) {
        if (e.k === 'react') { this.player.reacted = true; this.player.reacting = true; this.player.reactT = e.rt; }
        else if (e.k === 'decoy') sim.decoys.push({ x: e.d[0], y: e.d[1], t: e.d[2], isDecoy: true, strong: !!e.d[3] });
        else if (e.k === 'blink') { this.player.x = e.p[0]; this.player.y = e.p[1]; }
      }
      this._framesAt(t, (id, inp) => { this._input = inp; });
      sim.events.length = 0;
      sim.stepGlitch(dt);
      sim.applyHumanIntent(this.player, dt, this._input);
      sim.stepCrowd(dt);
      for (const h of sim.hunters) updateHunter(h, dt, sim);
      for (const e of sim.events) {
        if (e.type === 'catchPlayer') { for (const h of sim.hunters) h.lock = 0; this.caught = true; this.done = true; break; }
        if (e.type === 'popBot') { if (e.agent.alive !== false) sim.removeAgent(e.agent); }
        else if (e.type === 'popDecoy') { const i = sim.decoys.indexOf(e.decoy); if (i >= 0) sim.decoys.splice(i, 1); e.hunter.target = null; }
      }
    } else {
      // phase 'j': things that happened between server ticks (joins, grace
      // drops, AI hunter takeover) — applied before this tick steps
      for (const e of evs) {
        if (e.ph !== 'j') continue;
        if (e.k === 'join') this._join(e.id, e.role);
        else if (e.k === 'cut') this._cut(e.id);
        else if (e.k === 'ai') this._spawnAi();
      }
      sim.stepGlitch(dt);
      this._framesAt(t, (id, inp) => this.inputs.set(id, inp));
      // apply intents (order-independent: applyHumanIntent touches no shared
      // state and consumes no rng, so per-agent order can't diverge)
      for (const [id, inp] of this.inputs) {
        const a = this.byId.get(id);
        if (!a || !a.alive) continue;
        sim.applyHumanIntent(a, dt, inp);
      }
      // phase 0: tag aims + tag catches — between the input pass and stepCrowd
      for (const e of evs) {
        if (e.ph !== 0) continue;
        if (e.k === 'face') { const a = this.byId.get(e.id); if (a) a.facing = e.a; }
        else if (e.k === 'cut') this._cut(e.id);
      }
      sim.stepCrowd(dt);
      sim.events.length = 0;
      for (const h of this.aiHunters) updateHunter(h, dt, sim);
      // phase 1: AI hunter catches — resolved after the AI update pass
      for (const e of evs) {
        if (e.ph !== 1) continue;
        if (e.k === 'cut') this._cut(e.id);
      }
    }

    this.tick++;
    if (this.tick >= this.data.ticks) this.done = true;
    return !this.done;
  }

  runToEnd() { while (this.step()); return this; }
}
