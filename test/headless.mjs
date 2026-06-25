// ============================================================
// HUMAN ERROR — headless engine test
// Runs the shared CrowdSim under Node (no DOM) for both modes and asserts
// it ticks without faulting. Wired into `npm run check`.
// ============================================================

import { CrowdSim } from '../engine/sim.mjs';
import { makeHunter, updateHunter, maxPlayerLock } from '../engine/hunter.mjs';

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
  assert(pops <= 3, 'solo: at most 3 bots can pop (no dead-target double counts), got ' + pops);
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

console.log('\nALL HEADLESS TESTS PASSED');
