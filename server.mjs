// ============================================================
// HUMAN ERROR — multiplayer server (zero npm dependencies)
// Raw WebSocket (RFC6455) + server-authoritative crowd sim.
// The crowd/glitch/movement all run through the SHARED engine (CrowdSim),
// the exact same code the solo game uses — one sim, two modes.
// Run:  node server.mjs   then open  http://localhost:8080
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { ARENA, BODY_R, MAPS, SKINS, POSE, skinIndex } from './engine/config.mjs';
import { clamp, dist, lerpAngle } from './engine/math.mjs';
import { CrowdSim } from './engine/sim.mjs';
import { freePoint } from './engine/geometry.mjs';
import { makeHunter, updateHunter } from './engine/hunter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

// pose string -> wire int (client keeps its compact numeric form)
const POSE_WIRE = { idle: 0, walk: 1, dance: 2 };

// ---------- static file server ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  // health check for hosting platforms (Render/Railway/Fly/etc.)
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok rooms=' + rooms.size);
  }
  if (url === '/') url = '/mp.html';
  else if (url === '/solo') url = '/index.html';
  const file = path.join(ROOT, path.normalize(url).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- minimal WebSocket (RFC6455) ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsAccept = (key) => crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

function wsSend(sock, str) {
  if (sock.destroyed) return;
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) header = Buffer.from([0x81, 126, (len >> 8) & 255, len & 255]);
  else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  try { sock.write(Buffer.concat([header, payload])); } catch (e) {}
}
const wsCloseFrame = (sock) => { try { sock.write(Buffer.from([0x88, 0])); } catch (e) {} };

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  onConnect(sock);

  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (buf.length < 2) break;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) break;
      let mask = null;
      if (masked) { mask = buf.slice(off, off + 4); off += 4; }
      const data = buf.slice(off, off + len);
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.slice(need);
      if (op === 8) { wsCloseFrame(sock); sock.destroy(); return; }
      else if (op === 9) { try { sock.write(Buffer.from([0x8a, 0])); } catch (e) {} }
      else if (op === 1) { try { onMessage(sock, JSON.parse(data.toString('utf8'))); } catch (e) {} }
    }
  });
  sock.on('close', () => onClose(sock));
  sock.on('error', () => onClose(sock));
});

// ============================================================
// MATCH RULES (multiplayer-specific; crowd sim is shared)
// ============================================================
const MATCH_SECS = 90, TAG_RANGE = 34, TAG_CONE = 1.1, MISS_STUN = 1.4;
const RECONNECT_GRACE = 20000;   // ms a dropped player's body is held for reconnect
const HIDER_SPEED = 140, HUNTER_SPEED = 132, NPC_SPEED = 58;
const MP_NPCS = 42, MP_BOTS = 6;   // denser crowd so hiders actually have cover
const AI_HUNTER_ID_BASE = 900000;   // stable ids for server-driven AI hunters (below human 1e6 range)

// Player network ids live in a high range so they never collide with the
// engine's per-match crowd ids (which start at 1). The human's body in the
// shared sim is stamped with this id, so the client can find "me" in snapshots.
let nextId = 1_000_000;
const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no O/0/I/1 ambiguity
const CODE_LEN = 4;
const MAX_PLAYERS = 12;

function genCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
    if (!rooms.has(c)) return c;
  }
  let c; do { c = ''; for (let i = 0; i < CODE_LEN + 2; i++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]; } while (rooms.has(c));
  return c;
}

function createRoom() {
  const code = genCode();
  const r = {
    code, state: 'lobby', players: new Map(), byToken: new Map(),
    sim: null, timer: MATCH_SECS, mapId: 'plaza',
  };
  rooms.set(code, r);
  return r;
}
function broadcast(room, obj) { const s = JSON.stringify(obj); for (const sock of room.players.keys()) wsSend(sock, s); }

const humanHiders = (room) => [...room.players.values()].filter(p => p.role === 'hider' && p.agent && p.agent.alive);
const theHunter = (room) => [...room.players.values()].find(p => p.role === 'hunter');

// Spawn a server-driven AI hunter into the room's shared sim. Used when no
// human wants the hunter seat (lone player) or when a human hunter drops out.
function spawnAiHunter(room) {
  if (!room.sim) return null;
  const h = makeHunter(room.aiHunters.length, 1, room.sim.rng, 3);
  h.id = AI_HUNTER_ID_BASE + room.aiHunters.length;
  room.aiHunters.push(h);
  return h;
}

function startMatch(room) {
  const humans = [...room.players.values()];
  if (humans.length === 0) return;

  const map = MAPS[(Math.random() * MAPS.length) | 0];
  room.mapId = map.id;
  room.skin = skinIndex(map.skin);
  room.timer = MATCH_SECS;

  // build the shared crowd sim for this match
  const sim = new CrowdSim({ seed: (Math.random() * 0xffffffff) >>> 0, mapId: map.id, npcCount: MP_NPCS, botCount: MP_BOTS });
  sim.buildCrowd();
  room.sim = sim;
  room.aiHunters = []; room.aiScore = 0;

  // Role assignment that never strands a lone player in an empty lobby:
  //  - 2+ humans  -> one human Hunter, the rest hiders (human-vs-human)
  //  - 1 human    -> that human hides; a server-driven AI Hunter stalks the crowd
  // Either way the dumb-human bots fill out the hider crowd so the arena is alive.
  const humanHunt = humans.length >= 2;
  const hunterIdx = humanHunt ? (Math.random() * humans.length) | 0 : -1;
  humans.forEach((p, i) => {
    const role = i === hunterIdx ? 'hunter' : 'hider';
    const agent = sim.addHuman({ role });
    agent.id = p.id;   // body id == player's network id so the client finds itself
    const fp = freePoint(sim.pillars, sim.rng); agent.x = fp.x; agent.y = fp.y;
    agent.skin = Math.max(0, room.skin);
    p.role = role; p.agent = agent; p.stunT = 0; p.score = 0;
    p.input = { up: 0, down: 0, left: 0, right: 0, shift: 0, dance: 0 }; p.tagEdge = false;
  });
  if (!humanHunt) spawnAiHunter(room);

  room.state = 'playing';
  broadcast(room, { t: 'start', skin: room.skin, mapId: map.id, ai: room.aiHunters.length });
}

function doTag(room, hunter) {
  if (hunter.stunT > 0) return;
  const h = hunter.agent;
  const sim = room.sim;
  let target = null, tdist = TAG_RANGE, isNPC = false;
  const consider = (b, npc) => {
    if (!b.alive) return;
    const d = dist(h.x, h.y, b.x, b.y);
    if (d > TAG_RANGE) return;
    let ang = Math.atan2(b.y - h.y, b.x - h.x) - h.facing;
    while (ang > Math.PI) ang -= Math.PI * 2; while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) > TAG_CONE) return;
    if (d < tdist) { tdist = d; target = b; isNPC = npc; }
  };
  for (const a of sim.agents) {
    if (a.role === 'hunter') continue;
    if (a.kind === 'npc') consider(a, true);
    else consider(a, false);   // hiders + bots are catchable
  }
  if (!target) { hunter.stunT = MISS_STUN * 0.5; broadcast(room, { t: 'event', msg: 'Hunter tagged empty air!' }); return; }
  if (isNPC) { hunter.stunT = MISS_STUN; broadcast(room, { t: 'event', msg: hunter.name + ' tagged an NPC — stunned!' }); return; }

  // caught a catchable body
  const isBot = target.kind === 'bot';
  const owner = isBot ? null : [...room.players.values()].find(p => p.agent === target);
  const who = isBot ? 'a dumb-human bot' : (owner ? owner.name : 'a human');
  sim.removeAgent(target);
  hunter.score = (hunter.score || 0) + 1;
  broadcast(room, { t: 'event', msg: hunter.name + (isBot ? ' caught ' : ' CAUGHT ') + who + '!' });
  broadcast(room, { t: 'caught', id: target.id, x: Math.round(target.x), y: Math.round(target.y), name: who });
  if (humanHiders(room).length === 0 && [...room.players.values()].some(p => p.role === 'hider')) endMatch(room, 'hunter');
}

// Resolve a catch emitted by an AI hunter (lone-player / hunter-left matches).
function resolveAiCatch(room, e) {
  const sim = room.sim;
  const a = e.type === 'popBot' ? e.agent : e.agent;
  if (!a || a.alive === false) return;
  const owner = e.type === 'catchHider' ? [...room.players.values()].find(p => p.agent === a) : null;
  const who = e.type === 'popBot' ? 'a dumb-human bot' : (owner ? owner.name : 'a human');
  sim.removeAgent(a);
  for (const h of room.aiHunters) if (h.target === a) { h.target = null; h.lock = 0; }
  room.aiScore = (room.aiScore || 0) + 1;
  broadcast(room, { t: 'event', msg: 'The AI Hunter ' + (e.type === 'popBot' ? 'caught ' : 'CAUGHT ') + who + '!' });
  broadcast(room, { t: 'caught', id: a.id, x: Math.round(a.x), y: Math.round(a.y), name: who });
  if (e.type === 'catchHider' && humanHiders(room).length === 0
      && [...room.players.values()].some(p => p.role === 'hider')) endMatch(room, 'hunter');
}

function endMatch(room, winner) {
  room.state = 'over';
  const hunter = theHunter(room);
  const score = hunter ? hunter.score : (room.aiScore || 0);
  broadcast(room, { t: 'over', winner, score });
}

function tick(room, dt) {
  if (room.state !== 'playing') return;
  const sim = room.sim;
  room.timer -= dt;
  if (room.timer <= 0) { room.timer = 0; endMatch(room, 'hiders'); return; }

  // glitch (shared)
  const g = sim.stepGlitch(dt);
  if (g) broadcast(room, { t: 'glitch', name: g.name });

  // apply human inputs, then advance the shared crowd
  for (const p of room.players.values()) {
    if (!p.agent || !p.agent.alive) continue;
    if (p.stunT > 0) p.stunT = Math.max(0, p.stunT - dt);
    if (p.agent.tauntT > 0) p.agent.tauntT -= dt;
    const inp = p.input || {};
    const ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const isHunter = p.role === 'hunter';
    const speed = isHunter ? HUNTER_SPEED : (inp.shift ? NPC_SPEED : HIDER_SPEED);
    const intent = (p.stunT > 0)
      ? { ix: 0, iy: 0, slow: false, dance: false, speed }
      : { ix, iy, slow: !!inp.shift, dance: !isHunter && !!inp.dance, speed };
    sim.applyHumanIntent(p.agent, dt, intent);
    if (isHunter && p.tagEdge) { p.tagEdge = false; doTag(room, p); }
  }
  sim.stepCrowd(dt);

  // advance any server-driven AI hunters through the SHARED hunter brain,
  // then resolve the catch events they emit.
  if (room.aiHunters && room.aiHunters.length) {
    sim.events.length = 0;
    for (const h of room.aiHunters) updateHunter(h, dt, sim);
    for (const e of sim.events) resolveAiCatch(room, e);
    if (room.state !== 'playing') return;   // a catch may have ended the match
  }

  // snapshot
  const bodies = [];
  for (const a of sim.agents) {
    if (!a.alive) continue;
    const kind = a.role === 'hunter' ? 'hunter' : (a.kind === 'human' ? 'hider' : 'npc');
    const s = {
      id: a.id, k: kind, sh: a.shape || 0,
      x: Math.round(a.x * 10) / 10, y: Math.round(a.y * 10) / 10,
      f: Math.round(a.facing * 100) / 100, p: POSE_WIRE[a.pose] ?? 0,
      ph: Math.round((a.dancePhase || a.animPhase) * 100) / 100,
    };
    if (a.tauntT > 0 && a.taunt >= 0) s.e = a.taunt;
    if (a.slipping && a.slip) s.sl = a.slip[0];   // tell-tale slip flag for juicing on clients
    bodies.push(s);
  }
  // AI hunters live outside sim.agents — emit them so clients draw the threat
  for (const h of room.aiHunters || []) {
    bodies.push({
      id: h.id, k: 'hunter', sh: 0,
      x: Math.round(h.x * 10) / 10, y: Math.round(h.y * 10) / 10,
      f: Math.round(h.facing * 100) / 100, p: 1, ph: 0,
    });
  }
  const anyHumanHiders = [...room.players.values()].some(p => p.role === 'hider');
  const hunter = theHunter(room);
  broadcast(room, {
    t: 'snap', timer: Math.ceil(room.timer), glitch: sim.glitch ? sim.glitch.name : null,
    bodies, hunterStun: hunter && hunter.stunT > 0 ? 1 : 0,
    hidersLeft: anyHumanHiders ? humanHiders(room).length : -1,
  });
}

// ---------- connection handlers ----------
function onConnect(sock) { sock._player = null; }
function joinRoom(sock, room, name, token) {
  // reconnect: same token + a body still held within the grace window
  if (token && room.byToken.has(token)) {
    const existing = room.byToken.get(token);
    if (existing.graceTimer) { clearTimeout(existing.graceTimer); existing.graceTimer = null; }
    room.players.delete(existing.sock);          // drop the dead socket key
    existing.sock = sock; existing.disconnected = false; sock._player = existing;
    room.players.set(sock, existing);
    wsSend(sock, JSON.stringify({ t: 'joined', id: existing.id, room: room.code, you: existing.name }));
    if (room.state === 'playing' && existing.agent) {
      // resume the match view; snapshots resume control of the same body/role
      wsSend(sock, JSON.stringify({ t: 'start', skin: room.skin, mapId: room.mapId, resumed: true }));
    } else {
      sendLobby(room);
    }
    return;
  }

  const player = {
    id: nextId++, name: (name || 'Player').slice(0, 14), room, role: 'spectator',
    agent: null, score: 0, stunT: 0, token: token || null, disconnected: false, graceTimer: null,
    input: { up: 0, down: 0, left: 0, right: 0, shift: 0, dance: 0 }, tagEdge: false, sock,
  };
  sock._player = player; room.players.set(sock, player);
  if (token) room.byToken.set(token, player);
  wsSend(sock, JSON.stringify({ t: 'joined', id: player.id, room: room.code, you: player.name }));
  // drop-in: a fresh player joining a live match enters immediately as a hider
  // (no "waiting" screen, no spectating until next round)
  if (room.state === 'playing' && room.sim) {
    const agent = room.sim.addHuman({ role: 'hider' });
    agent.id = player.id; agent.skin = Math.max(0, room.skin || 0);
    const fp = freePoint(room.sim.pillars, room.sim.rng); agent.x = fp.x; agent.y = fp.y;
    player.role = 'hider'; player.agent = agent;
    broadcast(room, { t: 'event', msg: player.name + ' dropped in!' });
    wsSend(sock, JSON.stringify({ t: 'start', skin: room.skin, mapId: room.mapId, resumed: true }));
  } else {
    sendLobby(room);
  }
}
function onMessage(sock, msg) {
  if (msg.t === 'create') { if (sock._player) return; joinRoom(sock, createRoom(), msg.name, msg.token); }
  else if (msg.t === 'quick') {
    if (sock._player) return;
    let room = null;
    for (const r of rooms.values()) if (r.public && r.state === 'lobby' && r.players.size < MAX_PLAYERS) { room = r; break; }
    if (!room) { room = createRoom(); room.public = true; }
    joinRoom(sock, room, msg.name, msg.token);
  } else if (msg.t === 'join') {
    if (sock._player) return;
    const code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = rooms.get(code);
    if (!room) { wsSend(sock, JSON.stringify({ t: 'error', msg: "No room '" + (code || '—') + "'. Check the code." })); return; }
    // a reconnecting player rebinds even on a full room; a new player must fit the cap
    const reconnecting = msg.token && room.byToken.has(msg.token);
    if (!reconnecting && room.players.size >= MAX_PLAYERS) { wsSend(sock, JSON.stringify({ t: 'error', msg: 'Room ' + code + ' is full.' })); return; }
    joinRoom(sock, room, msg.name, msg.token);
  } else if (!sock._player) return;
  else if (msg.t === 'start') { const room = sock._player.room; if (room.state !== 'playing') startMatch(room); }
  else if (msg.t === 'input') { const p = sock._player; p.input = msg.k || p.input; if (msg.tag) p.tagEdge = true; }
  else if (msg.t === 'emote') { const p = sock._player; if (p.agent && p.agent.alive) { p.agent.taunt = clamp(msg.e | 0, 0, 3); p.agent.tauntT = 1.6; } }
  else if (msg.t === 'again') {
    const room = sock._player.room;
    if (room.state === 'over') {
      room.state = 'lobby'; room.sim = null; room.aiHunters = []; room.aiScore = 0;
      for (const pl of room.players.values()) { pl.role = 'spectator'; pl.agent = null; }
      sendLobby(room);
    }
  }
}
function sendLobby(room) {
  const players = [...room.players.values()].map(p => ({ name: p.name, off: !!p.disconnected }));
  broadcast(room, { t: 'lobby', players, code: room.code, canStart: players.length >= 1, state: room.state });
}

// Fully remove a player whose reconnect grace expired (or who left a lobby).
function dropPlayer(room, p) {
  room.players.delete(p.sock);
  if (p.token) room.byToken.delete(p.token);
  if (p.agent && room.sim) room.sim.removeAgent(p.agent);
  if (room.players.size === 0 && room.byToken.size === 0) { rooms.delete(room.code); return; }
  if (room.state === 'playing') {
    if (p.role === 'hunter') {
      // don't strand the hiders — hand the hunt to an AI so the round continues
      const hidersAlive = [...room.players.values()].some(x => x.role === 'hider' && x.agent && x.agent.alive);
      if (room.sim && hidersAlive) {
        if (!room.aiHunters) { room.aiHunters = []; room.aiScore = 0; }
        spawnAiHunter(room);
        broadcast(room, { t: 'event', msg: 'Hunter bailed — an AI Hunter takes over!' });
      } else endMatch(room, 'hiders');
    } else if (humanHiders(room).length === 0 && [...room.players.values()].some(x => x.role === 'hider')) {
      endMatch(room, 'hunter');
    }
  }
  sendLobby(room);
}

function onClose(sock) {
  const p = sock._player; if (!p) return;
  const room = p.room;
  // mid-match with a body + token: hold the body for a reconnect grace window
  if (room.state === 'playing' && p.agent && p.agent.alive && p.token) {
    p.disconnected = true;
    p.input = { up: 0, down: 0, left: 0, right: 0, shift: 0, dance: 0 };  // freeze in place
    p.graceTimer = setTimeout(() => { if (p.disconnected) dropPlayer(room, p); }, RECONNECT_GRACE);
    sendLobby(room);
    return;
  }
  dropPlayer(room, p);
}

// ---------- main loop ----------
const TICK = 1000 / 20;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(); const dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  for (const room of rooms.values()) tick(room, dt);
}, TICK);

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) for (const ni of ifaces[name] || [])
    if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  return out;
}
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  HUMAN ERROR — multiplayer server running (shared engine)\n');
  console.log('  This machine:   http://localhost:' + PORT);
  const ips = lanIPs();
  if (ips.length) {
    console.log('  Same-wifi friends, share one of these:');
    for (const ip of ips) console.log('                  http://' + ip + ':' + PORT);
  }
  console.log("  Internet friends:  run  'npm run tunnel'  in another terminal (gives a public link).");
  console.log('\n  Open the URL, Create a room, share the code, press Start.\n');
});

// graceful shutdown so hosting platforms (which send SIGTERM on deploy/restart)
// don't leave sockets hanging
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return; shuttingDown = true;
  console.log('\n  ' + signal + ' received — shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();   // hard stop if sockets linger
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
