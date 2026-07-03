// ============================================================
// Generate placeholder app icons (no image tooling required):
// solid surveillance-dark square with a pink "error" stripe.
// Writes src-tauri/icons/{32x32.png,128x128.png,icon.png,icon.ico}.
// Swap for real art before shipping to Steam.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'src-tauri', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size) {
  // pixels: dark bg, pink horizontal stripe, green corner dot (REC light)
  const bg = [0x0b, 0x0f, 0x17, 255], pink = [0xff, 0x2e, 0x63, 255], green = [0x2b, 0xd4, 0x79, 255];
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let px = bg;
      if (y >= size * 0.55 && y < size * 0.72) px = pink;
      const dx = x - size * 0.22, dy = y - size * 0.24, r = size * 0.09;
      if (dx * dx + dy * dy < r * r) px = green;
      raw.set(px, row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(sizes) {
  const pngs = sizes.map(s => ({ s, data: png(s) }));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { s, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...pngs.map(p => p.data)]);
}

fs.writeFileSync(path.join(outDir, '32x32.png'), png(32));
fs.writeFileSync(path.join(outDir, '128x128.png'), png(128));
fs.writeFileSync(path.join(outDir, '128x128@2x.png'), png(256));
fs.writeFileSync(path.join(outDir, 'icon.png'), png(512));
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico([16, 32, 48, 256]));
console.log('icons written to', outDir);
