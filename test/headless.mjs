// ============================================================
// HUMAN ERROR — headless engine test
// Runs the shared CrowdSim under Node (no DOM) for both modes and asserts
// it ticks without faulting. Wired into `npm run check`.
// ============================================================

import { CrowdSim } from '../engine/sim.mjs';
import { makeHunter, updateHunter, maxPlayerLock } from '../engine/hunter.mjs';
import { ReplayRecorder, ReplayPlayer, REPLAY_VERSION } from '../engine/replay.mjs';

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

// ---- solo mode: AI hunters chase a wandering hider ----
{
  const sim = new CrowdSim({ seed: 12345, mapId: 'plaza' });
  sim.buildCrowd();
  const player = sim.addHuman({ role: 'hider' });
  sim.player = player;
  const n = 3; sim.hunters = [];
  for (let i = 0; i < n; i++) sim.hunters.push(makeHunter(i, n, sim.rng, 4));
  let glitches = 0, pops = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 5400; i++) {
    sim.events.length = 0;
    sim.applyHumanIntent(player, dt, { ix: Math.sin(i / 40), iy: Math.cos(i / 55), slow: i % 120 < 60 });
    if (sim.stepGlitch(dt)) glitches++;
    sim.stepCrowd(dt);
    for (const h of sim.hunters) updateHunter(h, dt, sim);
    for (const e of sim.events) if (e.type === 'popBot' && e.agent.alive !== false) { pops++; sim.removeAgent(e.agent); }
  }
  assert(glitches > 0, 'solo: glitches should fire over 90s');
  assert(pops <= sim.botCount, 'solo: at most botCount bots can pop (no dead-target double counts), got ' + pops + '/' + sim.botCount);
  assert(sim.agents.includes(player), 'solo: player still present');
  assert(maxPlayerLock(sim.hunters, player) >= 0, 'solo: lock readable');
  console.log('solo OK — glitches=%d botPops=%d agents=%d', glitches, pops, sim.agents.length);
}

// ---- multiplayer mode: human hunter + human hiders + crowd ----
{
  const sim = new CrowdSim({ seed: 777, mapId: 'stacks', npcCount: 30, botCount: 6 });
  sim.buildCrowd();
  const hunter = sim.addHuman({ role: 'hunter' });
  const hiders = [sim.addHuman({ role: 'hider' }), sim.addHuman({ role: 'hider' }), sim.addHuman({ role: 'hider' })];
  const dt = 1 / 20;
  for (let i = 0; i < 1800; i++) {
    sim.applyHumanIntent(hunter, dt, { ix: 1, iy: 0, speed: 132 });
    for (const hd of hiders) sim.applyHumanIntent(hd, dt, { ix: Math.cos(i / 30), iy: Math.sin(i / 25), slow: true, speed: 58 });
    sim.stepGlitch(dt);
    sim.stepCrowd(dt);
  }
  const snap = sim.snapshot();
  assert(snap.agents.length === sim.agents.length, 'mp: snapshot covers all agents');
  assert(sim.agents.filter(a => a.role === 'hunter').length === 1, 'mp: exactly one hunter');
  console.log('mp OK — agents=%d snapshotBytes≈%d', sim.agents.length, JSON.stringify(snap).length);
}

// ---- determinism: same seed -> same crowd layout ----
{
  const a = new CrowdSim({ seed: 42, mapId: 'atrium' }); a.buildCrowd();
  const b = new CrowdSim({ seed: 42, mapId: 'atrium' }); b.buildCrowd();
  const ax = a.agents.map(p => p.x.toFixed(3)).join(',');
  const bx = b.agents.map(p => p.x.toFixed(3)).join(',');
  assert(ax === bx, 'determinism: identical seed must produce identical spawns');
  console.log('determinism OK — %d agents reproducible', a.agents.length);
}

// ---- replay: record a 30s solo run, re-simulate, byte-identical positions ----
{
  const seed = 987654321, mapId = 'plaza', wave = 3, hunterN = 2, lockSp = 0.93;
  const spawn = { x: 480, y: 505 };
  const npcCount = 46, botCount = 4, dt = 1 / 60;

  // live run — mirrors the solo client's fixed-step loop exactly
  const sim = new CrowdSim({ seed, mapId, npcCount, botCount });
  sim.lockSpeed = lockSp;
  sim.buildCrowd();
  const player = sim.addHuman({ role: 'hider', x: spawn.x, y: spawn.y });
  sim.player = player;
  sim.hunters = [];
  for (let i = 0; i < hunterN; i++) sim.hunters.push(makeHunter(i, hunterN, sim.rng, wave));

  const rec = new ReplayRecorder();
  rec.begin({ mode: 'solo', seed, mapId, npcCount, botCount, dt, solo: { wave, hunters: hunterN, lockSpeed: lockSp, spawn } });

  let caught = false;
  for (let t = 0; t < 1800 && !caught; t++) {
    const slow = t % 120 < 60;
    const intent = { ix: Math.sin(t / 40), iy: Math.cos(t / 55), slow, dance: t % 300 > 260, speed: slow ? 58 : 140 };
    if (t === 300) {   // one-shot event path (decoy drop) must replay too
      sim.decoys.push({ x: player.x, y: player.y, t: 5, isDecoy: true, strong: false });
      rec.event(t, { k: 'decoy', d: [player.x, player.y, 5, 0] });
    }
    rec.frame(t, { [player.id]: intent });
    sim.events.length = 0;
    sim.stepGlitch(dt);
    sim.applyHumanIntent(player, dt, intent);
    sim.stepCrowd(dt);
    for (const h of sim.hunters) updateHunter(h, dt, sim);
    for (const e of sim.events) {
      if (e.type === 'catchPlayer') { for (const h of sim.hunters) h.lock = 0; caught = true; break; }
      if (e.type === 'popBot') { if (e.agent.alive !== false) sim.removeAgent(e.agent); }
      else if (e.type === 'popDecoy') { const i = sim.decoys.indexOf(e.decoy); if (i >= 0) sim.decoys.splice(i, 1); e.hunter.target = null; }
    }
  }

  const json = rec.end({ reason: caught ? 'caught' : 'time' });
  const wire = JSON.stringify(json);   // round-trip like localStorage / the wire would
  assert(wire.length < 200_000, 'replay: 30s solo run should stay small, got ' + wire.length + ' bytes');

  const rp = new ReplayPlayer(JSON.parse(wire));
  rp.runToEnd();

  const posStr = (s) => s.agents.map(a => a.id + ':' + a.x + ',' + a.y + ',' + a.facing + ',' + a.pose).join('|');
  const huntStr = (hs) => hs.map(h => h.x + ',' + h.y + ',' + h.facing + ',' + h.lock).join('|');
  assert(posStr(sim) === posStr(rp.sim), 'replay: re-simulated agent positions must be byte-identical');
  assert(huntStr(sim.hunters) === huntStr(rp.sim.hunters), 'replay: re-simulated hunter states must be byte-identical');
  assert(rp.caught === caught, 'replay: outcome (caught) must match the live run');

  // version gate: a mismatched replay must refuse to play
  let refused = false;
  try { new ReplayPlayer({ ...json, v: REPLAY_VERSION + 1 }); } catch (e) { refused = true; }
  assert(refused, 'replay: mismatched REPLAY_VERSION must be refused');

  console.log('replay OK — %d ticks, %d bytes, caught=%s, byte-identical re-sim', json.ticks, wire.length, caught);
}

console.log('\nALL HEADLESS TESTS PASSED');
