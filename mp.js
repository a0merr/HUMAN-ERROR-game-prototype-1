"use strict";
(() => {

const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
const W = cv.width, H = cv.height;
const PAD = 40;
const ARENA = { x: PAD, y: PAD + 30, w: W - PAD*2, h: H - PAD*2 - 30 };
const BODY_R = 11;
const PILLARS = [
  { x: ARENA.x + ARENA.w*0.24, y: ARENA.y + ARENA.h*0.30, w: 46, h: 46 },
  { x: ARENA.x + ARENA.w*0.62, y: ARENA.y + ARENA.h*0.24, w: 54, h: 40 },
  { x: ARENA.x + ARENA.w*0.40, y: ARENA.y + ARENA.h*0.62, w: 60, h: 44 },
  { x: ARENA.x + ARENA.w*0.78, y: ARENA.y + ARENA.h*0.66, w: 44, h: 56 },
  { x: ARENA.x + ARENA.w*0.12, y: ARENA.y + ARENA.h*0.70, w: 40, h: 40 },
];
const POSE = { IDLE: 0, WALK: 1, DANCE: 2 };
const SKIN = "#8a93a6", SKIN_HEAD = "#9aa3b6", SKIN_DARK = "#5b6376";

// ---------- dom ----------
const $ = id => document.getElementById(id);
const joinScreen = $("joinScreen"), lobbyScreen = $("lobbyScreen"), resultScreen = $("resultScreen");
const elRole = $("role"), elTimer = $("timer"), elTimerLabel = $("timerLabel"), elGlitch = $("glitch"), elFeed = $("feed");

// ---------- state ----------
let ws = null, myId = null, myName = "", myRole = "spectator";
let snapPrev = null, snapCur = null, snapTime = 0;   // interpolation buffers
let glitchOff = 0, feedItems = [];

// ---------- websocket ----------
function connect(name, room) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(proto + "://" + location.host);
  $("connStatus").textContent = "Connecting…";
  ws.onopen = () => { ws.send(JSON.stringify({ t: "join", name, room })); };
  ws.onclose = () => { $("connStatus").textContent = "Disconnected. Is the server running? (node server.js)"; };
  ws.onerror = () => { $("connStatus").textContent = "Connection failed. Run: node server.js, then open http://localhost:8080"; };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function handle(m) {
  if (m.t === "joined") { myId = m.id; myName = m.you; }
  else if (m.t === "lobby") {
    $("lobbyCode").textContent = m.code;
    const list = $("playerList");
    list.innerHTML = m.players.map(p => `<div class="pl"><span>${esc(p.name)}</span><span class="hint">${p.name===myName?"you":""}</span></div>`).join("");
    if (m.state !== "playing") { joinScreen.classList.add("hidden"); lobbyScreen.classList.remove("hidden"); }
  }
  else if (m.t === "start") { lobbyScreen.classList.add("hidden"); resultScreen.classList.add("hidden"); feedItems = []; renderFeed(); snapPrev = snapCur = null; }
  else if (m.t === "snap") {
    snapPrev = snapCur; snapCur = m; snapTime = performance.now();
    elTimer.textContent = m.timer;
    const me = m.bodies.find(b => b.id === myId);
    setRole(me ? (me.k === "hunter" ? "hunter" : "hider") : "spectator");
    elTimerLabel.textContent = myRole === "hunter" ? "TAG THE HUMANS" : "SURVIVE";
  }
  else if (m.t === "glitch") { elGlitch.textContent = m.name; elGlitch.style.opacity = "1"; glitchOff = 2.2; }
  else if (m.t === "event") { feed(m.msg); }
  else if (m.t === "over") {
    resultScreen.classList.remove("hidden");
    const win = m.winner === "hunter" ? "HUNTER WINS" : "HIDERS SURVIVE";
    $("resultTitle").innerHTML = win;
    $("resultTitle").style.color = m.winner === "hunter" ? "var(--pink)" : "var(--green)";
    let sub = "";
    if (myRole === "hunter") sub = "You caught " + m.score + ".";
    else if (myRole === "hider") sub = m.winner === "hiders" ? "You blended to the end." : "The crowd fell. Better luck next round.";
    else sub = "Hunter caught " + m.score + ".";
    $("resultSub").textContent = sub;
  }
}
function setRole(r) {
  if (r === myRole) return;
  myRole = r; elRole.className = r;
  elRole.textContent = r === "hunter" ? "YOU ARE THE HUNTER" : r === "hider" ? "BLEND IN — HIDER" : "SPECTATOR";
}
function esc(s) { return String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

// ---------- input ----------
const keys = {};
let tagQueued = false;
addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
  if (k === " " && myRole === "hunter") tagQueued = true;
});
addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

setInterval(() => {
  if (!ws || ws.readyState !== 1 || myRole === "spectator") return;
  const k = {
    up: keys["w"] || keys["arrowup"] ? 1 : 0,
    down: keys["s"] || keys["arrowdown"] ? 1 : 0,
    left: keys["a"] || keys["arrowleft"] ? 1 : 0,
    right: keys["d"] || keys["arrowright"] ? 1 : 0,
    shift: keys["shift"] ? 1 : 0,
    dance: keys["f"] ? 1 : 0,
  };
  send({ t: "input", k, tag: tagQueued });
  tagQueued = false;
}, 1000 / 20);

// ---------- feed ----------
function feed(msg) { feedItems.unshift({ msg, t: 3 }); if (feedItems.length > 4) feedItems.pop(); renderFeed(); }
function renderFeed() { elFeed.innerHTML = feedItems.map(f => `<div style="opacity:${Math.max(0,Math.min(1,f.t/3)).toFixed(2)}">${esc(f.msg)}</div>`).join(""); }

// ---------- draw ----------
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawPerson(b, t) {
  const isHunter = b.k === "hunter";
  const moving = b._moving;
  const dancing = b.p === POSE.DANCE;
  const bodyCol = isHunter ? "#ff2e63" : SKIN, headCol = isHunter ? "#cfe6ff" : SKIN_HEAD;
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(0,11,9,3.2,0,0,Math.PI*2); ctx.fill();
  const swing = moving ? Math.sin(t*11 + b.id)*4 : 0;
  ctx.strokeStyle = SKIN_DARK; ctx.lineWidth = 3.2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-2.5,4); ctx.lineTo(-2.5+swing*0.4,11); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2.5,4); ctx.lineTo(2.5-swing*0.4,11); ctx.stroke();
  const bob = dancing ? Math.sin(b.ph)*1.6 : (moving ? Math.abs(Math.sin(t*11+b.id))*0.8 : Math.sin(t*2+b.id)*0.5);
  ctx.fillStyle = bodyCol; roundRect(-5,-6+bob,10,12,4); ctx.fill();
  ctx.strokeStyle = bodyCol; ctx.lineWidth = 3;
  if (dancing) { const w = Math.sin(b.ph*1.5)*0.5; ctx.beginPath(); ctx.moveTo(-4,-3+bob); ctx.lineTo(-8,-9+w*3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(4,-3+bob); ctx.lineTo(8,-9-w*3); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-4,-2+bob); ctx.lineTo(-5,3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(4,-2+bob); ctx.lineTo(5,3); ctx.stroke(); }
  ctx.fillStyle = headCol; ctx.beginPath(); ctx.arc(0,-10+bob,5,0,Math.PI*2); ctx.fill();
  if (isHunter) { ctx.fillStyle = "rgba(10,20,35,.9)"; ctx.save(); ctx.translate(0,-10+bob); ctx.rotate(b.f); roundRect(1,-2.4,4.5,4.8,1.5); ctx.fill(); ctx.restore(); }
  ctx.restore();
}

function lerp(a, b, t) { return a + (b - a) * t; }
function interpBodies() {
  // interpolate between snapPrev and snapCur by id
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

let t0 = 0;
function frame(ts) {
  const t = ts / 1000; t0 = t;
  ctx.clearRect(0,0,W,H);

  // floor + grid
  ctx.fillStyle = "#0e1422"; ctx.fillRect(ARENA.x,ARENA.y,ARENA.w,ARENA.h);
  ctx.strokeStyle = "#172033"; ctx.lineWidth = 1;
  for (let gx=ARENA.x; gx<=ARENA.x+ARENA.w; gx+=40){ ctx.beginPath(); ctx.moveTo(gx,ARENA.y); ctx.lineTo(gx,ARENA.y+ARENA.h); ctx.stroke(); }
  for (let gy=ARENA.y; gy<=ARENA.y+ARENA.h; gy+=40){ ctx.beginPath(); ctx.moveTo(ARENA.x,gy); ctx.lineTo(ARENA.x+ARENA.w,gy); ctx.stroke(); }
  for (const p of PILLARS) { ctx.fillStyle="#1c2942"; roundRect(p.x,p.y,p.w,p.h,6); ctx.fill(); ctx.strokeStyle="#2c3e5e"; ctx.lineWidth=2; ctx.stroke(); }
  ctx.strokeStyle = "#243149"; ctx.lineWidth = 2; ctx.strokeRect(ARENA.x,ARENA.y,ARENA.w,ARENA.h);

  const bodies = interpBodies();
  bodies.sort((p,q) => p.y - q.y);
  const me = bodies.find(b => b.id === myId);

  for (const b of bodies) if (b.id !== myId) drawPerson(b, t);
  if (me) {
    drawPerson(me, t);
    // your marker
    const col = myRole === "hunter" ? "rgba(255,46,99,.95)" : "rgba(43,212,121,.95)";
    ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.arc(me.x, me.y, BODY_R+7, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = col; ctx.font = "bold 10px Segoe UI"; ctx.textAlign = "center";
    ctx.fillText(myRole === "hunter" ? "HUNTER (YOU)" : "YOU", me.x, me.y - BODY_R - 16);
    // hunter tag reticle
    if (myRole === "hunter") {
      const rng = 34;
      ctx.strokeStyle = "rgba(255,46,99,.35)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.arc(me.x, me.y, rng, me.f - 0.55, me.f + 0.55); ctx.closePath(); ctx.stroke();
    }
  }

  // glitch banner fade
  if (glitchOff > 0) { glitchOff -= 1/60; if (glitchOff <= 0) elGlitch.style.opacity = "0"; }
  // feed fade
  if (feedItems.length) { let changed = false; for (const f of feedItems) f.t -= 1/60; const n = feedItems.length; feedItems = feedItems.filter(f => f.t > 0); if (feedItems.length !== n) changed = true; if (changed || feedItems.some(f=>f.t<1)) renderFeed(); }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- ui buttons ----------
$("joinBtn").addEventListener("click", () => {
  const name = $("nameInput").value.trim() || "Player";
  const room = ($("roomInput").value.trim() || "PARTY").toUpperCase();
  connect(name, room);
});
$("roomInput").addEventListener("keydown", e => { if (e.key === "Enter") $("joinBtn").click(); });
$("startBtn").addEventListener("click", () => send({ t: "start" }));
$("againBtn").addEventListener("click", () => { send({ t: "again" }); resultScreen.classList.add("hidden"); lobbyScreen.classList.remove("hidden"); });

})();
