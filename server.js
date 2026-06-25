"use strict";
// ============================================================
// HUMAN ERROR — multiplayer server (zero dependencies)
// Raw WebSocket (no npm), server-authoritative crowd sim.
// Run:  node server.js   then open  http://localhost:8080
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

// ---------- static file server ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  let url = req.url.split("?")[0];
  if (url === "/") url = "/mp.html";
  const file = path.join(ROOT, path.normalize(url).replace(/^([/\\])+/, ""));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- minimal WebSocket (RFC6455) ----------
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function wsAccept(key) { return crypto.createHash("sha1").update(key + WS_GUID).digest("base64"); }

function wsSend(sock, str) {
  if (sock.destroyed) return;
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.from([0x81, 126, (len >> 8) & 255, len & 255]); }
  else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  try { sock.write(Buffer.concat([header, payload])); } catch (e) {}
}
function wsCloseFrame(sock) { try { sock.write(Buffer.from([0x88, 0])); } catch (e) {} }

server.on("upgrade", (req, sock) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) { sock.destroy(); return; }
  sock.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n"
  );
  onConnect(sock);

  let buf = Buffer.alloc(0);
  sock.on("data", (chunk) => {
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
      else if (op === 1) { try { onMessage(sock, JSON.parse(data.toString("utf8"))); } catch (e) {} }
    }
  });
  sock.on("close", () => onClose(sock));
  sock.on("error", () => onClose(sock));
});

// ============================================================
// GAME
// ============================================================
const W = 960, H = 600, PAD = 40;
const ARENA = { x: PAD, y: PAD + 30, w: W - PAD * 2, h: H - PAD * 2 - 30 };
const BODY_R = 11;
const PILLARS = [
  { x: ARENA.x + ARENA.w * 0.24, y: ARENA.y + ARENA.h * 0.30, w: 46, h: 46 },
  { x: ARENA.x + ARENA.w * 0.62, y: ARENA.y + ARENA.h * 0.24, w: 54, h: 40 },
  { x: ARENA.x + ARENA.w * 0.40, y: ARENA.y + ARENA.h * 0.62, w: 60, h: 44 },
  { x: ARENA.x + ARENA.w * 0.78, y: ARENA.y + ARENA.h * 0.66, w: 44, h: 56 },
  { x: ARENA.x + ARENA.w * 0.12, y: ARENA.y + ARENA.h * 0.70, w: 40, h: 40 },
];
const POSE = { IDLE: 0, WALK: 1, DANCE: 2 };
const NPC_SPEED = 58, HIDER_SPEED = 140, HUNTER_SPEED = 132, DANCE_DRIFT = 5;
const MATCH_SECS = 90, TAG_RANGE = 34, TAG_CONE = 1.1, MISS_STUN = 1.4;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
function insidePillar(x, y) { for (const p of PILLARS) if (x > p.x - BODY_R && x < p.x + p.w + BODY_R && y > p.y - BODY_R && y < p.y + p.h + BODY_R) return true; return false; }
function collide(a) {
  for (const p of PILLARS) {
    const cx = clamp(a.x, p.x, p.x + p.w), cy = clamp(a.y, p.y, p.y + p.h);
    const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy);
    if (d < BODY_R && d > 0.0001) { a.x = cx + dx / d * BODY_R; a.y = cy + dy / d * BODY_R; }
    else if (d <= 0.0001) a.x = p.x - BODY_R;
  }
}
function freePoint() {
  for (let i = 0; i < 30; i++) {
    const x = rand(ARENA.x + 25, ARENA.x + ARENA.w - 25), y = rand(ARENA.y + 25, ARENA.y + ARENA.h - 25);
    let ok = true;
    for (const p of PILLARS) if (x > p.x - 18 && x < p.x + p.w + 18 && y > p.y - 18 && y < p.y + p.h + 18) { ok = false; break; }
    if (ok) return { x, y };
  }
  return { x: rand(ARENA.x + 25, ARENA.x + ARENA.w - 25), y: rand(ARENA.y + 25, ARENA.y + ARENA.h - 25) };
}

let nextId = 1;
function makeCrowdAgent(bot) {
  const fp = freePoint();
  return {
    id: nextId++, kind: bot ? "bot" : "npc",
    x: fp.x, y: fp.y, vx: 0, vy: 0, facing: rand(0, 6.28),
    pose: POSE.IDLE, state: POSE.IDLE, timer: rand(0.5, 2.5),
    wpx: 0, wpy: 0, dancePhase: rand(0, 6.28), phase: rand(0, 6.28),
    reacting: false, reactT: 0,
    slipT: rand(2.5, 6), slipping: false, slip: "", slipDur: 0, sdx: 0, sdy: 0,
    alive: true,
  };
}
function newWaypoint(a) { const p = freePoint(); a.wpx = p.x; a.wpy = p.y; }

function updateNPC(a, dt, room) {
  a.phase += dt; a.timer -= dt;
  if (a.reacting) {
    a.reactT -= dt; reaction(a, dt, room);
    if (a.reactT <= 0) { a.reacting = false; a.state = POSE.IDLE; a.timer = rand(0.6, 1.6); }
    a.pose = a.state; collide(a); return;
  }
  if (a.timer <= 0) {
    const r = Math.random();
    if (r < 0.42) { a.state = POSE.IDLE; a.timer = rand(1.2, 3); }
    else if (r < 0.78) { a.state = POSE.WALK; newWaypoint(a); a.timer = rand(2, 4); }
    else { a.state = POSE.DANCE; a.timer = rand(1.6, 3.6); }
  }
  if (a.state === POSE.IDLE) { a.vx = a.vy = 0; }
  else if (a.state === POSE.WALK) {
    const dx = a.wpx - a.x, dy = a.wpy - a.y, d = Math.hypot(dx, dy);
    if (d < 6) { a.state = POSE.IDLE; a.timer = rand(0.6, 1.8); a.vx = a.vy = 0; }
    else { a.vx = dx / d * NPC_SPEED; a.vy = dy / d * NPC_SPEED; a.facing = lerpAngle(a.facing, Math.atan2(dy, dx), 0.2); }
  } else { a.dancePhase += dt * 8; a.vx = Math.cos(a.dancePhase) * DANCE_DRIFT; a.vy = Math.sin(a.dancePhase * 1.3) * DANCE_DRIFT; }
  a.x = clamp(a.x + a.vx * dt, ARENA.x + BODY_R, ARENA.x + ARENA.w - BODY_R);
  a.y = clamp(a.y + a.vy * dt, ARENA.y + BODY_R, ARENA.y + ARENA.h - BODY_R);
  collide(a); a.pose = a.state;
}
const SLIPS = ["sprint", "flinch", "overdance", "bunch"];
function updateBot(a, dt, room) {
  if (a.reacting) { updateNPC(a, dt, room); return; }
  if (!a.slipping) { a.slipT -= dt; if (a.slipT <= 0) { a.slipping = true; a.slip = SLIPS[(Math.random() * 4) | 0]; a.slipDur = rand(0.5, 1.1); const an = rand(0, 6.28); a.sdx = Math.cos(an); a.sdy = Math.sin(an); } }
  if (a.slipping) {
    a.slipDur -= dt; a.phase += dt;
    if (a.slip === "sprint") { a.pose = POSE.WALK; a.x += a.sdx * 140 * dt; a.y += a.sdy * 140 * dt; a.facing = Math.atan2(a.sdy, a.sdx); }
    else if (a.slip === "flinch") {
      let nx = 0, ny = 0, best = 1e9;
      for (const h of room.hunters()) { const d = dist(a.x, a.y, h.x, h.y); if (d < best) { best = d; nx = a.x - h.x; ny = a.y - h.y; } }
      const d = Math.hypot(nx, ny) || 1; a.pose = POSE.WALK; a.x += nx / d * 150 * dt; a.y += ny / d * 150 * dt;
    } else if (a.slip === "overdance") { a.pose = POSE.DANCE; a.dancePhase += dt * 18; a.vx = a.vy = 0; }
    else { a.pose = POSE.WALK; a.x += a.sdx * 70 * dt; a.y += a.sdy * 70 * dt; }
    a.x = clamp(a.x, ARENA.x + BODY_R, ARENA.x + ARENA.w - BODY_R);
    a.y = clamp(a.y, ARENA.y + BODY_R, ARENA.y + ARENA.h - BODY_R);
    collide(a);
    if (a.slipDur <= 0) { a.slipping = false; a.slipT = rand(2.8, 6.5); }
    return;
  }
  updateNPC(a, dt, room);
}
const GLITCHES = [
  { type: "alarm", name: "🚨 FIRE ALARM", t: 2.4 },
  { type: "cash", name: "💸 CASH DROPPED", t: 2.2 },
  { type: "freeze", name: "🧊 SYSTEM FREEZE", t: 1.9 },
];
function reaction(a, dt, room) {
  const g = room.glitch; if (!g) return;
  if (g.type === "alarm") { const ex = a.x < W / 2 ? ARENA.x + 24 : ARENA.x + ARENA.w - 24, ey = ARENA.y + 24; const dx = ex - a.x, dy = ey - a.y, d = Math.hypot(dx, dy) || 1; a.x += dx / d * 135 * dt; a.y += dy / d * 135 * dt; a.facing = Math.atan2(dy, dx); a.state = POSE.WALK; }
  else if (g.type === "cash") { const dx = W / 2 - a.x, dy = ARENA.y + ARENA.h / 2 - a.y, d = Math.hypot(dx, dy) || 1; a.x += dx / d * 115 * dt; a.y += dy / d * 115 * dt; a.facing = Math.atan2(dy, dx); a.state = POSE.WALK; }
  else { a.vx = a.vy = 0; a.state = POSE.IDLE; }
  a.x = clamp(a.x, ARENA.x + BODY_R, ARENA.x + ARENA.w - BODY_R);
  a.y = clamp(a.y, ARENA.y + BODY_R, ARENA.y + ARENA.h - BODY_R);
}

// ---------- rooms ----------
const rooms = new Map();   // code -> room
function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = {
      code, state: "lobby", players: new Map(), // sock -> player
      npcs: [], bots: [], glitch: null, glitchCD: 6, timer: MATCH_SECS,
      hunters() { return [...this.players.values()].filter(p => p.role === "hunter" && p.alive); },
    };
    rooms.set(code, r);
  }
  return r;
}
function broadcast(room, obj) { const s = JSON.stringify(obj); for (const sock of room.players.keys()) wsSend(sock, s); }

function startMatch(room) {
  const humans = [...room.players.values()];
  if (humans.length === 0) return;
  // assign one hunter, rest hiders (solo: that one is hunter)
  humans.forEach(p => { p.role = "hider"; p.alive = true; p.score = 0; p.stunT = 0; });
  const hunter = humans[(Math.random() * humans.length) | 0];
  hunter.role = "hunter";
  for (const p of humans) {
    const fp = freePoint(); p.x = fp.x; p.y = fp.y; p.facing = Math.PI / 2; p.pose = POSE.IDLE; p.phase = Math.random() * 6.28; p.dancePhase = Math.random() * 6.28;
    p.input = { up: 0, down: 0, left: 0, right: 0, shift: 0, dance: 0 }; p.tagEdge = false;
  }
  room.npcs = []; room.bots = [];
  for (let i = 0; i < 30; i++) room.npcs.push(makeCrowdAgent(false));
  for (let i = 0; i < 6; i++) room.bots.push(makeCrowdAgent(true));
  room.glitch = null; room.glitchCD = rand(5, 8); room.timer = MATCH_SECS; room.state = "playing";
  broadcast(room, { t: "start" });
}

function humanHiders(room) { return [...room.players.values()].filter(p => p.role === "hider" && p.alive); }

function doTag(room, hunter) {
  if (hunter.stunT > 0) return;
  // candidates: human hiders + bots(dumb humans) = catchable; npcs = miss
  let target = null, tdist = TAG_RANGE, isNPC = false;
  function consider(b, npc) {
    const d = dist(hunter.x, hunter.y, b.x, b.y);
    if (d > TAG_RANGE) return;
    let ang = Math.atan2(b.y - hunter.y, b.x - hunter.x) - hunter.facing;
    while (ang > Math.PI) ang -= Math.PI * 2; while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) > TAG_CONE) return;
    if (d < tdist) { tdist = d; target = b; isNPC = npc; }
  }
  for (const p of humanHiders(room)) consider(p, false);
  for (const b of room.bots) if (b.alive) consider(b, false);
  for (const n of room.npcs) consider(n, true);
  if (!target) { hunter.stunT = MISS_STUN * 0.5; broadcast(room, { t: "event", msg: "Hunter tagged empty air!" }); return; }
  if (isNPC) { hunter.stunT = MISS_STUN; broadcast(room, { t: "event", msg: hunter.name + " tagged an NPC — stunned!" }); return; }
  // caught a catchable body
  target.alive = false; hunter.score = (hunter.score || 0) + 1;
  if (target.kind === "bot") broadcast(room, { t: "event", msg: hunter.name + " caught a dumb-human bot!" });
  else broadcast(room, { t: "event", msg: hunter.name + " CAUGHT " + target.name + "!" });
  // win if all human hiders gone
  if (humanHiders(room).length === 0 && [...room.players.values()].some(p => p.role === "hider")) endMatch(room, "hunter");
}

function endMatch(room, winner) {
  room.state = "over";
  const hunter = [...room.players.values()].find(p => p.role === "hunter");
  broadcast(room, { t: "over", winner, score: hunter ? hunter.score : 0 });
}

function tick(room, dt) {
  if (room.state !== "playing") return;
  room.timer -= dt;
  if (room.timer <= 0) { room.timer = 0; endMatch(room, "hiders"); return; }
  // glitch
  if (!room.glitch) { room.glitchCD -= dt; if (room.glitchCD <= 0) { const g = { ...GLITCHES[(Math.random() * 3) | 0] }; room.glitch = g; for (const a of room.npcs) { a.reacting = true; a.reactT = g.t; } for (const a of room.bots) if (a.alive) { if (Math.random() < 0.45) continue; a.reacting = true; a.reactT = g.t; } broadcast(room, { t: "glitch", name: g.name }); } }
  else { room.glitch.t -= dt; if (room.glitch.t <= 0) { room.glitch = null; room.glitchCD = rand(6, 11); } }
  for (const a of room.npcs) updateNPC(a, dt, room);
  for (const a of room.bots) if (a.alive) updateBot(a, dt, room);
  // humans
  for (const p of room.players.values()) {
    if (p.role === "spectator" || !p.alive) continue;
    if (p.stunT > 0) p.stunT = Math.max(0, p.stunT - dt);
    const inp = p.input || {};
    let ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const isHunter = p.role === "hunter";
    const spd = isHunter ? HUNTER_SPEED : (inp.shift ? NPC_SPEED : HIDER_SPEED);
    if ((ix || iy) && p.stunT <= 0) {
      const d = Math.hypot(ix, iy); p.vx = ix / d * spd; p.vy = iy / d * spd;
      p.facing = lerpAngle(p.facing, Math.atan2(iy, ix), 0.35); p.pose = POSE.WALK;
    } else { p.vx = p.vy = 0; if (!isHunter && inp.dance) { p.pose = POSE.DANCE; p.dancePhase += dt * 8; } else p.pose = POSE.IDLE; }
    p.x = clamp(p.x + p.vx * dt, ARENA.x + BODY_R, ARENA.x + ARENA.w - BODY_R);
    p.y = clamp(p.y + p.vy * dt, ARENA.y + BODY_R, ARENA.y + ARENA.h - BODY_R);
    p.phase += dt; collide(p);
    if (isHunter && p.tagEdge) { p.tagEdge = false; doTag(room, p); }
  }
  // snapshot
  const bodies = [];
  for (const p of room.players.values()) if (p.role !== "spectator" && p.alive) bodies.push(snap(p, p.role === "hunter" ? "hunter" : "hider", p.id));
  for (const b of room.bots) if (b.alive) bodies.push(snap(b, "npc", b.id));
  for (const n of room.npcs) bodies.push(snap(n, "npc", n.id));
  broadcast(room, { t: "snap", timer: Math.ceil(room.timer), glitch: room.glitch ? room.glitch.name : null,
    bodies, hunterStun: anyHunterStun(room) });
}
function anyHunterStun(room) { const h = [...room.players.values()].find(p => p.role === "hunter"); return h ? (h.stunT > 0 ? 1 : 0) : 0; }
function snap(a, kind, id) {
  return { id, k: kind, x: Math.round(a.x * 10) / 10, y: Math.round(a.y * 10) / 10,
    f: Math.round(a.facing * 100) / 100, p: a.pose, ph: Math.round((a.dancePhase || a.phase) * 100) / 100 };
}

// ---------- connection handlers ----------
function onConnect(sock) { sock._player = null; }
function onMessage(sock, msg) {
  if (msg.t === "join") {
    const code = (msg.room || "PUBLIC").toUpperCase().slice(0, 8);
    const room = getRoom(code);
    const player = { id: nextId++, name: (msg.name || "Player").slice(0, 14), room, role: "spectator",
      x: 0, y: 0, facing: 0, pose: 0, phase: 0, dancePhase: 0, alive: true, score: 0, stunT: 0,
      input: { up: 0, down: 0, left: 0, right: 0, shift: 0, dance: 0 }, tagEdge: false, sock };
    sock._player = player; room.players.set(sock, player);
    wsSend(sock, JSON.stringify({ t: "joined", id: player.id, room: code, you: player.name }));
    sendLobby(room);
    if (room.state === "playing") { player.role = "spectator"; } // join mid-match as spectator
  } else if (!sock._player) return;
  else if (msg.t === "start") { const room = sock._player.room; if (room.state !== "playing") startMatch(room); }
  else if (msg.t === "input") { const p = sock._player; p.input = msg.k || p.input; if (msg.tag) p.tagEdge = true; }
  else if (msg.t === "again") { const room = sock._player.room; if (room.state === "over") { room.state = "lobby"; for (const pl of room.players.values()) pl.role = "spectator"; sendLobby(room); } }
}
function sendLobby(room) {
  const players = [...room.players.values()].map(p => ({ name: p.name }));
  broadcast(room, { t: "lobby", players, code: room.code, canStart: players.length >= 1, state: room.state });
}
function onClose(sock) {
  const p = sock._player; if (!p) return;
  const room = p.room; room.players.delete(sock);
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.state === "playing") {
    if (p.role === "hunter") endMatch(room, "hiders");
    else if (room.players.size && humanHiders(room).length === 0 && [...room.players.values()].some(x => x.role === "hider")) endMatch(room, "hunter");
  }
  sendLobby(room);
}

// ---------- main loop ----------
const TICK = 1000 / 20;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(); const dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  for (const room of rooms.values()) tick(room, dt);
}, TICK);

server.listen(PORT, () => {
  console.log("HUMAN ERROR multiplayer on  http://localhost:" + PORT);
  console.log("Open it in two browser tabs, join the same room code, press Start.");
});
