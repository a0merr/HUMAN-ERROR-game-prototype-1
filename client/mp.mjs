// ============================================================
// HUMAN ERROR — MULTIPLAYER client (module)
// Renders interpolated snapshots from the authoritative server. Shares the
// engine's map layouts, skins and palette so visuals match the server sim.
// ============================================================

import { ARENA, BODY_R, BODY_SHAPES, mapById, SKINS, PALETTE } from '../engine/config.mjs';
import { clamp, lerpAngle } from '../engine/math.mjs';
import { collidePillars, clampArena } from '../engine/geometry.mjs';
import { initAudio, beep } from './audio.mjs';
import { ClipRecorder } from './clip.mjs';

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;
const clip = new ClipRecorder(cv, { gameName: 'human-error' });

const POSE = { IDLE: 0, WALK: 1, DANCE: 2 };
// must match server.mjs movement tunables for prediction to track
const HIDER_SPEED = 140, HUNTER_SPEED = 132, NPC_SPEED = 58;
const EMOJI = ['👋', '🕺', '😎', '🔥'];

// per-map floor tint (cosmetic only; geometry comes from engine maps)
const THEME = {
  plaza:  { floor: '#0e1422', grid: '#172033', pillar: '#1c2942', edge: '#2c3e5e' },
  atrium: { floor: '#0e1a16', grid: '#15271f', pillar: '#1b3328', edge: '#2c5040' },
  stacks: { floor: '#140e1f', grid: '#211733', pillar: '#2a1c42', edge: '#43305e' },
};

let curMapId = 'plaza', crowdSkin = 0;

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const joinScreen = $('joinScreen'), lobbyScreen = $('lobbyScreen'), resultScreen = $('resultScreen');
const elRole = $('role'), elTimer = $('timer'), elTimerLabel = $('timerLabel'), elGlitch = $('glitch'), elFeed = $('feed');

// ---------- state ----------
let ws = null, myId = null, myName = '', myRole = 'spectator';
let snapPrev = null, snapCur = null, snapTime = 0;
let glitchOff = 0, feedItems = [];
let hidersLeft = -1, myStun = 0, prevStun = 0;
let killcam = null, flash = 0, shake = 0, particles = [];
// client-side prediction of the local body (instant input response; the server
// remains authoritative — predicted pos is gently corrected toward each snapshot)
let pred = null, predPose = POSE.IDLE, predTs = 0;
let lastStore = 0;   // throttle localStorage activity stamps

// ---------- audio ----------
function sfx(name) {
  const a = { tag: () => { beep(523, 0.08, 'triangle', 0.06); setTimeout(() => beep(784, 0.14, 'triangle', 0.06), 70); },
    caughtMe: () => { beep(220, 0.12, 'sawtooth', 0.08); setTimeout(() => beep(130, 0.28, 'sawtooth', 0.07), 110); },
    stun: () => beep(150, 0.18, 'square', 0.07),
    taunt: () => beep(660, 0.07, 'triangle', 0.05),
    glitch: () => beep(170, 0.25, 'sawtooth', 0.08),
    start: () => { beep(440, 0.09, 'triangle', 0.05); setTimeout(() => beep(660, 0.12, 'triangle', 0.05), 90); },
    win: () => { beep(523, 0.1, 'triangle', 0.06); setTimeout(() => beep(784, 0.18, 'triangle', 0.06), 110); },
    lose: () => { beep(330, 0.12, 'sawtooth', 0.06); setTimeout(() => beep(196, 0.25, 'sawtooth', 0.06), 120); } };
  if (a[name]) a[name]();
}
function burst(x, y, color, n = 18) {
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 40 + Math.random() * 200; particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.5, color }); }
}

// ---------- identity / reconnect ----------
function token() {
  let t = localStorage.getItem('he.token');
  if (!t) { t = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('he.token', t); }
  return t;
}

// ---------- websocket ----------
function connect(action) {
  action.token = token();
  if (action.name) localStorage.setItem('he.name', action.name);
  if (ws && ws.readyState === 1) { send(action); return; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host);
  $('connStatus').textContent = 'Connecting…';
  ws.onopen = () => { $('connStatus').textContent = ''; ws.send(JSON.stringify(action)); };
  ws.onclose = () => { $('connStatus').textContent = 'Disconnected. Is the server running? (node server.mjs)'; };
  ws.onerror = () => { $('connStatus').textContent = 'Connection failed. Run: node server.mjs, then open http://localhost:8080'; };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function handle(m) {
  if (m.t === 'error') { $('connStatus').textContent = m.msg; }
  else if (m.t === 'joined') {
    myId = m.id; myName = m.you;
    localStorage.setItem('he.room', m.room); localStorage.setItem('he.ts', String(Date.now()));
  }
  else if (m.t === 'lobby') {
    $('lobbyCode').textContent = m.code;
    $('playerList').innerHTML = m.players.map(p => `<div class="pl"><span>${esc(p.name)}</span><span class="hint">${p.name === myName ? 'you' : ''}</span></div>`).join('');
    if (m.state !== 'playing') { joinScreen.classList.add('hidden'); lobbyScreen.classList.remove('hidden'); }
  } else if (m.t === 'start') {
    crowdSkin = m.skin || 0; curMapId = m.mapId || 'plaza';
    clip.start();
    lobbyScreen.classList.add('hidden'); resultScreen.classList.add('hidden');
    feedItems = []; renderFeed(); snapPrev = snapCur = null; killcam = null; flash = 0; shake = 0; particles = [];
    myStun = prevStun = 0; hidersLeft = -1; pred = null; predTs = 0;
    feed('Map: ' + mapById(curMapId).name + ' · Skin: ' + (SKINS[crowdSkin] ? SKINS[crowdSkin].id : '—')); sfx('start');
  } else if (m.t === 'snap') {
    const now = Date.now(); if (now - lastStore > 2000) { lastStore = now; localStorage.setItem('he.ts', String(now)); }
    snapPrev = snapCur; snapCur = m; snapTime = performance.now();
    elTimer.textContent = m.timer;
    hidersLeft = (m.hidersLeft === undefined) ? -1 : m.hidersLeft;
    const me = m.bodies.find(b => b.id === myId);
    setRole(me ? (me.k === 'hunter' ? 'hunter' : 'hider') : 'spectator');
    if (myRole === 'hunter') { myStun = m.hunterStun ? 1 : 0; if (myStun && !prevStun) { sfx('stun'); shake = Math.max(shake, 7); } prevStun = myStun; elTimerLabel.textContent = hidersLeft > 0 ? 'HUMANS LEFT: ' + hidersLeft : 'TAG THE BOTS'; }
    else if (myRole === 'hider') elTimerLabel.textContent = 'SURVIVE' + (hidersLeft > 0 ? ' · ' + hidersLeft + ' LEFT' : '');
    else elTimerLabel.textContent = 'SPECTATING' + (hidersLeft > 0 ? ' · ' + hidersLeft + ' LEFT' : '');
  } else if (m.t === 'glitch') { elGlitch.textContent = m.name; elGlitch.style.opacity = '1'; glitchOff = 2.2; sfx('glitch'); }
  else if (m.t === 'event') { feed(m.msg); }
  else if (m.t === 'caught') {
    flash = 0.6; shake = Math.max(shake, 9); burst(m.x, m.y, '#ff2e63', 24);
    let cl = false;
    if (m.id === myId) { killcam = { x: m.x, y: m.y, t: 0, dur: 2.0 }; sfx('caughtMe'); cl = clip.capture('busted'); }
    else { sfx('tag'); if (myRole === 'hunter') cl = clip.capture('catch'); }
    if (cl) feed('🎬 Clip saved');
  } else if (m.t === 'over') {
    localStorage.removeItem('he.room');   // match ended — don't auto-rejoin into it
    resultScreen.classList.remove('hidden');
    const iWon = (myRole === 'hider' && m.winner === 'hiders') || (myRole === 'hunter' && m.winner === 'hunter');
    sfx(iWon ? 'win' : 'lose');
    const win = m.winner === 'hunter' ? 'HUNTER WINS' : 'HIDERS SURVIVE';
    $('resultTitle').innerHTML = win;
    $('resultTitle').style.color = m.winner === 'hunter' ? 'var(--pink)' : 'var(--green)';
    let sub = '';
    if (myRole === 'hunter') sub = 'You caught ' + m.score + '.';
    else if (myRole === 'hider') sub = m.winner === 'hiders' ? 'You blended to the end.' : 'The crowd fell. Better luck next round.';
    else sub = 'Hunter caught ' + m.score + '.';
    $('resultSub').textContent = sub;
  }
}
function setRole(r) {
  if (r === myRole) return;
  myRole = r; elRole.className = r;
  elRole.textContent = r === 'hunter' ? 'YOU ARE THE HUNTER' : r === 'hider' ? 'BLEND IN — HIDER' : 'SPECTATOR';
}
const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ---------- input ----------
const keys = {};
let tagQueued = false;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (k === ' ' && myRole === 'hunter') tagQueued = true;
  if (myRole !== 'spectator' && k >= '1' && k <= '4') { send({ t: 'emote', e: parseInt(k, 10) - 1 }); sfx('taunt'); }
  if (k === 'p') screenshot();
  if (k === 'c') { if (clip.capture('clip')) feed('🎬 Clip saved'); }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
function screenshot() {
  try { const a = document.createElement('a'); a.download = 'human-error-' + Date.now() + '.png'; a.href = cv.toDataURL('image/png'); a.click(); feed('📸 Screenshot saved'); } catch (e) {}
}
setInterval(() => {
  if (!ws || ws.readyState !== 1 || myRole === 'spectator') return;
  const k = {
    up: keys['w'] || keys['arrowup'] ? 1 : 0, down: keys['s'] || keys['arrowdown'] ? 1 : 0,
    left: keys['a'] || keys['arrowleft'] ? 1 : 0, right: keys['d'] || keys['arrowright'] ? 1 : 0,
    shift: keys['shift'] ? 1 : 0, dance: keys['f'] ? 1 : 0,
  };
  send({ t: 'input', k, tag: tagQueued });
  tagQueued = false;
}, 1000 / 20);

// ---------- feed ----------
function feed(msg) { feedItems.unshift({ msg, t: 3 }); if (feedItems.length > 4) feedItems.pop(); renderFeed(); }
function renderFeed() { elFeed.innerHTML = feedItems.map(f => `<div style="opacity:${Math.max(0, Math.min(1, f.t / 3)).toFixed(2)}">${esc(f.msg)}</div>`).join(''); }

// ---------- draw ----------
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawPerson(b, t) {
  const isHunter = b.k === 'hunter';
  const moving = b._moving;
  const dancing = b.p === POSE.DANCE;
  const sk = SKINS[crowdSkin] || SKINS[0];
  const bodyCol = isHunter ? '#ff2e63' : sk.body, headCol = isHunter ? '#cfe6ff' : sk.head;
  const bs = BODY_SHAPES[b.sh || 0] || BODY_SHAPES[0];
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 11, 9 * bs.sx, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  if (!isHunter) ctx.scale(bs.bw / 10, bs.bh / 12);
  const swing = moving ? Math.sin(t * 11 + b.id) * 4 : 0;
  ctx.strokeStyle = sk.dark; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-2.5, 4); ctx.lineTo(-2.5 + swing * 0.4, 11); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2.5, 4); ctx.lineTo(2.5 - swing * 0.4, 11); ctx.stroke();
  const bob = dancing ? Math.sin(b.ph) * 1.6 : (moving ? Math.abs(Math.sin(t * 11 + b.id)) * 0.8 : Math.sin(t * 2 + b.id) * 0.5);
  ctx.fillStyle = bodyCol; roundRect(-5, -6 + bob, 10, 12, 4); ctx.fill();
  ctx.strokeStyle = bodyCol; ctx.lineWidth = 3;
  if (dancing) { const w = Math.sin(b.ph * 1.5) * 0.5; ctx.beginPath(); ctx.moveTo(-4, -3 + bob); ctx.lineTo(-8, -9 + w * 3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(4, -3 + bob); ctx.lineTo(8, -9 - w * 3); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-4, -2 + bob); ctx.lineTo(-5, 3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(4, -2 + bob); ctx.lineTo(5, 3); ctx.stroke(); }
  ctx.fillStyle = headCol; ctx.beginPath(); ctx.arc(0, -10 + bob, 5, 0, Math.PI * 2); ctx.fill();
  if (isHunter) { ctx.fillStyle = 'rgba(10,20,35,.9)'; ctx.save(); ctx.translate(0, -10 + bob); ctx.rotate(b.f); roundRect(1, -2.4, 4.5, 4.8, 1.5); ctx.fill(); ctx.restore(); }
  if (b.e !== undefined && b.e !== null && EMOJI[b.e]) {
    ctx.font = '16px Segoe UI Emoji, Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(EMOJI[b.e], 0, -24 + bob); ctx.textBaseline = 'alphabetic';
  }
  // TELL marker — a bot mid-slip (sent as b.sl: s/f/o/b) gets a pulsing callout
  if (b.sl) {
    const ico = { s: '💨', f: '😱', o: '🤪', b: '👀' }[b.sl] || '⚠️';
    const pulse = 0.5 + 0.5 * Math.sin((t * 16) + b.id);
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.45 * pulse; ctx.strokeStyle = '#ff2e63'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, -1, 15 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.font = '15px "Segoe UI Emoji", Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(ico, 0, -27 + bob);
    ctx.restore();
  }
  ctx.restore();
}

// Advance the predicted local body from current input, then nudge it toward the
// latest authoritative position. Returns {x,y,facing,pose} or null.
function predict() {
  const now = performance.now();
  const dt = predTs ? clamp((now - predTs) / 1000, 0, 0.05) : 0;
  predTs = now;
  if (!snapCur || myRole === 'spectator') { pred = null; return null; }
  const sb = snapCur.bodies.find(b => b.id === myId);
  if (!sb) { pred = null; return null; }
  if (!pred) pred = { x: sb.x, y: sb.y, facing: sb.f };

  const isHunter = myRole === 'hunter';
  let ix = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
  let iy = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
  if (isHunter && myStun) { ix = iy = 0; }
  const speed = isHunter ? HUNTER_SPEED : (keys['shift'] ? NPC_SPEED : HIDER_SPEED);

  if (ix || iy) {
    const d = Math.hypot(ix, iy);
    pred.x += ix / d * speed * dt; pred.y += iy / d * speed * dt;
    pred.facing = lerpAngle(pred.facing, Math.atan2(iy, ix), 0.35);
    predPose = POSE.WALK;
  } else {
    predPose = (!isHunter && keys['f']) ? POSE.DANCE : POSE.IDLE;
  }
  collidePillars(pred, mapById(curMapId).pillars);
  clampArena(pred);

  // reconcile drift toward the server (strong on localhost, smooths jitter on the wire)
  const corr = clamp(6 * dt, 0, 1);
  pred.x += (sb.x - pred.x) * corr;
  pred.y += (sb.y - pred.y) * corr;
  return { x: pred.x, y: pred.y, facing: pred.facing, pose: predPose };
}

const lerp = (a, b, t) => a + (b - a) * t;
function interpBodies() {
  if (!snapCur) return [];
  const a = snapPrev, b = snapCur;
  const dtFrac = a ? Math.min(1, (performance.now() - snapTime) / 50) : 1;
  const prevMap = {};
  if (a) for (const bd of a.bodies) prevMap[bd.id] = bd;
  return b.bodies.map(cur => {
    const p = prevMap[cur.id];
    if (!p) return { ...cur, _moving: cur.p === POSE.WALK };
    const x = lerp(p.x, cur.x, dtFrac), y = lerp(p.y, cur.y, dtFrac);
    const moving = Math.hypot(cur.x - p.x, cur.y - p.y) > 0.3 || cur.p === POSE.WALK;
    return { ...cur, x, y, _moving: moving };
  });
}

function frame(ts) {
  const t = ts / 1000;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0.2) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
  if (killcam) { const e = Math.min(1, killcam.t / 0.5), ez = 1 - Math.pow(1 - e, 3), zoom = 1 + 1.6 * ez; ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-killcam.x, -killcam.y); }

  const th = THEME[curMapId] || THEME.plaza;
  const pillars = mapById(curMapId).pillars;
  ctx.fillStyle = th.floor; ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
  for (let gx = ARENA.x; gx <= ARENA.x + ARENA.w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, ARENA.y); ctx.lineTo(gx, ARENA.y + ARENA.h); ctx.stroke(); }
  for (let gy = ARENA.y; gy <= ARENA.y + ARENA.h; gy += 40) { ctx.beginPath(); ctx.moveTo(ARENA.x, gy); ctx.lineTo(ARENA.x + ARENA.w, gy); ctx.stroke(); }
  for (const p of pillars) { ctx.fillStyle = th.pillar; roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill(); ctx.strokeStyle = th.edge; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.strokeStyle = '#243149'; ctx.lineWidth = 2; ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

  const bodies = interpBodies();
  const me = bodies.find(b => b.id === myId);
  // override the local body with the predicted pose for instant input response
  const pm = predict();
  if (me && pm) { me.x = pm.x; me.y = pm.y; me.f = pm.facing; me.p = pm.pose; me._moving = pm.pose === POSE.WALK; }
  bodies.sort((p, q) => p.y - q.y);
  for (const b of bodies) if (b.id !== myId) drawPerson(b, t);
  if (me) {
    drawPerson(me, t);
    const col = myRole === 'hunter' ? 'rgba(255,46,99,.95)' : 'rgba(43,212,121,.95)';
    ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.arc(me.x, me.y, BODY_R + 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col; ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(myRole === 'hunter' ? 'HUNTER (YOU)' : 'YOU', me.x, me.y - BODY_R - 16);
    if (myRole === 'hunter') {
      ctx.strokeStyle = myStun ? 'rgba(120,130,150,.5)' : 'rgba(255,46,99,.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.arc(me.x, me.y, 34, me.f - 0.55, me.f + 0.55); ctx.closePath(); ctx.stroke();
    }
  }

  for (const p of particles) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }
  ctx.globalAlpha = 1;
  if (killcam) { const pulse = 2 + Math.sin(killcam.t * 12) * 1.2; ctx.strokeStyle = 'rgba(255,46,99,.95)'; ctx.lineWidth = pulse; ctx.beginPath(); ctx.arc(killcam.x, killcam.y, BODY_R + 6, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();

  if (flash > 0) { ctx.fillStyle = 'rgba(255,46,99,' + (flash * 0.4).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); flash -= 1 / 60; }
  if (killcam) {
    killcam.t += (1 / 60) * 0.5;
    if (killcam.t > 0.45) {
      const a = Math.min(1, (killcam.t - 0.45) / 0.3);
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center';
      ctx.fillStyle = '#ff2e63'; ctx.font = '900 60px Segoe UI'; ctx.fillText('HUMAN ERROR', W / 2, H / 2 - 8);
      ctx.fillStyle = '#e8edf5'; ctx.font = '700 20px Segoe UI'; ctx.fillText("YOU'RE OUT — too human.", W / 2, H / 2 + 30);
      ctx.restore();
    }
    if (killcam.t >= killcam.dur) killcam = null;
  }
  if (myRole === 'hunter' && myStun) { ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,46,99,.85)'; ctx.font = '800 18px Segoe UI'; ctx.fillText('STUNNED — wrong target', W / 2, H - 90); ctx.restore(); }

  shake *= 0.86;
  if (particles.length) { for (const p of particles) { p.x += p.vx / 60; p.y += p.vy / 60; p.vx *= 0.92; p.vy *= 0.92; p.life -= 1 / 60; } particles = particles.filter(p => p.life > 0); }
  if (glitchOff > 0) { glitchOff -= 1 / 60; if (glitchOff <= 0) elGlitch.style.opacity = '0'; }
  if (feedItems.length) { let changed = false; for (const f of feedItems) f.t -= 1 / 60; const n = feedItems.length; feedItems = feedItems.filter(f => f.t > 0); if (feedItems.length !== n) changed = true; if (changed || feedItems.some(f => f.t < 1)) renderFeed(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- ui buttons ----------
const curName = () => $('nameInput').value.trim() || 'Player';
$('quickBtn').addEventListener('click', () => { initAudio(); connect({ t: 'quick', name: curName() }); });
$('createBtn').addEventListener('click', () => { initAudio(); connect({ t: 'create', name: curName() }); });
$('joinBtn').addEventListener('click', () => {
  initAudio();
  const room = $('roomInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!room) { $('connStatus').textContent = 'Enter a room code, or Create Room.'; return; }
  connect({ t: 'join', name: curName(), room });
});
$('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').addEventListener('click', () => send({ t: 'start' }));
$('againBtn').addEventListener('click', () => { send({ t: 'again' }); resultScreen.classList.add('hidden'); lobbyScreen.classList.remove('hidden'); });

// ---------- auto-reconnect on reload ----------
// If we were recently in a room (same browser, persistent token), rejoin it.
// The server resumes our body + role if the match is still inside the grace window.
(function autoRejoin() {
  try {
    const room = localStorage.getItem('he.room');
    const ts = +localStorage.getItem('he.ts') || 0;
    if (room && Date.now() - ts < 60000) {
      const nm = localStorage.getItem('he.name') || 'Player';
      $('nameInput').value = nm;
      $('connStatus').textContent = 'Reconnecting to ' + room + '…';
      initAudio();
      connect({ t: 'join', name: nm, room });
    }
  } catch (e) {}
})();
