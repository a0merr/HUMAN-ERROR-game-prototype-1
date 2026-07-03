// ============================================================
// HUMAN ERROR — server abuse test (Node only, zero deps, no browser)
// Connects raw sockets to a running server (PORT env, default 8123) and
// throws garbage at it: non-HTTP bytes, malformed WS frames, oversized
// payloads, JSON garbage, message floods, room-create floods.
// Asserts the process stays up and a healthy client in another room keeps
// receiving snapshots the whole time.
//
//   PORT=8123 node server.mjs &
//   PORT=8123 node test/abuse.mjs
// ============================================================

import net from 'node:net';
import crypto from 'node:crypto';

const PORT = +(process.env.PORT || 8123);
let failed = false;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed = true; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- tiny RFC6455 client ----
function encodeFrame(payloadBuf) {
  const mask = crypto.randomBytes(4);
  const len = payloadBuf.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, 0x80 | len]);
  else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  const body = Buffer.from(payloadBuf);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

function wsConnect() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let hs = Buffer.alloc(0), upgraded = false, buf = Buffer.alloc(0), settled = false;
    const client = {
      sock, messages: [], closed: false, onmsg: null,
      send(obj) { try { sock.write(encodeFrame(Buffer.from(JSON.stringify(obj)))); } catch (e) {} },
      sendText(str) { try { sock.write(encodeFrame(Buffer.from(str))); } catch (e) {} },
      sendRaw(b) { try { sock.write(b); } catch (e) {} },
      close() { try { sock.destroy(); } catch (e) {} },
    };
    const timer = setTimeout(() => { if (!settled) { settled = true; sock.destroy(); reject(new Error('upgrade timeout')); } }, 3000);
    sock.on('connect', () => {
      sock.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const data = buf.slice(off, off + len); buf = buf.slice(off + len);
        if (op === 1) { try { const m = JSON.parse(data.toString('utf8')); client.messages.push(m); if (client.onmsg) client.onmsg(m); } catch (e) {} }
      }
    }
    sock.on('data', (chunk) => {
      if (upgraded) return onData(chunk);
      hs = Buffer.concat([hs, chunk]);
      const idx = hs.indexOf('\r\n\r\n');
      if (idx < 0) return;
      if (!hs.toString('utf8', 0, 20).startsWith('HTTP/1.1 101')) {
        if (!settled) { settled = true; clearTimeout(timer); sock.destroy(); reject(new Error('no 101')); }
        return;
      }
      upgraded = true;
      const rest = hs.slice(idx + 4);
      if (!settled) { settled = true; clearTimeout(timer); resolve(client); }
      if (rest.length) onData(rest);
    });
    sock.on('close', () => { client.closed = true; if (!settled) { settled = true; clearTimeout(timer); reject(new Error('closed pre-upgrade')); } });
    sock.on('error', () => { client.closed = true; });
  });
}

const waitFor = async (fn, ms = 4000, step = 50) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return fn();
};

// ---- healthy witness: create a room, start a solo-vs-AI match, count snaps ----
const healthy = await wsConnect();
healthy.send({ t: 'create', name: 'Witness', token: 'witness-token' });
let snaps = 0;
healthy.onmsg = (m) => {
  if (m.t === 'snap') snaps++;
  if (m.t === 'lobby' && m.state === 'lobby') healthy.send({ t: 'start' });
  if (m.t === 'over') healthy.send({ t: 'again' });   // keep the feed alive for the whole test
};
assert(await waitFor(() => snaps > 5), 'healthy client receives snapshots');
const snapsFlowing = async (label) => {
  const before = snaps;
  await sleep(700);
  assert(snaps > before, 'healthy client still receiving snapshots ' + label);
};

// ---- 1) raw non-HTTP garbage on the TCP port ----
{
  const g = net.connect(PORT, '127.0.0.1');
  g.on('error', () => {});
  g.on('connect', () => { g.write(crypto.randomBytes(2048)); setTimeout(() => g.destroy(), 300); });
  await sleep(500);
  await snapsFlowing('after raw TCP garbage');
}

// ---- 2) garbage WS frames after a real handshake ----
{
  const c = await wsConnect();
  c.sendRaw(crypto.randomBytes(512));
  await sleep(400);
  c.close();
  await snapsFlowing('after garbage WS frames');
}

// ---- 3) oversized payload (> 4 KB) must kill only that socket ----
{
  const c = await wsConnect();
  c.sendText('x'.repeat(8192));
  assert(await waitFor(() => c.closed, 3000), 'oversized frame disconnects the offending socket');
  await snapsFlowing('after oversized payload');
}

// ---- 4) malformed JSON payload must kill only that socket ----
{
  const c = await wsConnect();
  c.sendText('{this is not json');
  assert(await waitFor(() => c.closed, 3000), 'malformed JSON disconnects the offending socket');
  await snapsFlowing('after malformed JSON');
}

// ---- 5) message flood: rate limiter drops, then closes the socket ----
{
  const c = await wsConnect();
  const flood = setInterval(() => { for (let i = 0; i < 40; i++) c.send({ t: 'input', k: { up: 1 } }); }, 50);
  const closed = await waitFor(() => c.closed, 6000);
  clearInterval(flood);
  assert(closed, 'sustained flood (~800 msg/s) closes the offending socket');
  await snapsFlowing('after message flood');
}

// ---- 6) concurrent room creates: per-IP cap kicks in ----
{
  const results = [];
  const clients = [];
  for (let i = 0; i < 6; i++) {
    try {
      const c = await wsConnect();
      clients.push(c);
      const p = new Promise((resolve) => {
        c.onmsg = (m) => { if (m.t === 'joined') resolve('joined'); if (m.t === 'error') resolve('error'); };
      });
      c.send({ t: 'create', name: 'Flood' + i });
      results.push(await Promise.race([p, sleep(2000).then(() => 'timeout')]));
    } catch (e) { results.push('refused'); }
  }
  const joined = results.filter(r => r === 'joined').length;
  const rejected = results.filter(r => r === 'error').length;
  // witness room counts toward the same IP, so 3 more creates fit under the cap of 4
  assert(joined <= 4, 'per-IP concurrent room cap enforced (joined=' + joined + ')');
  assert(rejected >= 2, 'excess creates get a friendly error (rejected=' + rejected + ')');
  for (const c of clients) c.close();
  await sleep(300);
  await snapsFlowing('after concurrent create burst');
}

// ---- 7) 20 rapid open->create->close cycles ----
{
  for (let i = 0; i < 20; i++) {
    try {
      const c = await wsConnect();
      c.send({ t: 'create', name: 'Churn' + i });
      await sleep(30);
      c.close();
    } catch (e) { /* refused is fine — server must just survive */ }
  }
  await snapsFlowing('after 20 rapid room-create cycles');
}

// ---- 8) socket-per-IP cap ----
{
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => wsConnect()));
  const up = attempts.filter(a => a.status === 'fulfilled').map(a => a.value);
  // witness holds 1 slot; the cap is 8 per IP, so at most 7 more upgrade —
  // and normal reconnects must still work (>0), i.e. counts don't leak
  assert(up.length >= 1 && up.length <= 7, 'per-IP socket cap enforced without leaking (extra sockets upgraded=' + up.length + ')');
  for (const c of up) c.close();
  await sleep(300);
  await snapsFlowing('after socket-cap burst');
}

// ---- final: healthz answers and the witness never died ----
{
  const ok = await new Promise((resolve) => {
    const req = net.connect(PORT, '127.0.0.1');
    let out = '';
    req.on('connect', () => req.write('GET /healthz HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    req.on('data', (d) => { out += d; });
    req.on('close', () => resolve(out.includes('200') && out.includes('ok')));
    req.on('error', () => resolve(false));
    setTimeout(() => { req.destroy(); resolve(false); }, 2000);
  });
  assert(ok, 'healthz still answers 200 after all abuse');
  assert(!healthy.closed, 'healthy client socket survived the entire run');
}

healthy.close();
console.log(failed ? '\nABUSE TEST FAILED' : '\nABUSE TEST PASSED');
process.exit(failed ? 1 : 0);
