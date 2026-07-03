// ============================================================
// HUMAN ERROR — surveillance-cam post FX  (signature look)
// One screen-space pass shared by the solo + multiplayer renderers so every
// frame — and therefore every auto-exported clip — reads as leaked security
// footage: phosphor-green tint, scanlines, grain, vignette, a REC/CAM/timecode
// overlay, and an RGB chroma-split punch on a catch.
//
// Pure presentation. No sim state, no DOM. Cheap: the grain is a single cached
// noise tile, scanlines are a cached pattern.
// ============================================================

let _noise = null, _scan = null;

function buildNoise() {
  if (_noise || typeof document === 'undefined') return _noise;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0); _noise = c; return c;
}

function buildScanlines(ctx) {
  if (_scan || typeof document === 'undefined') return _scan;
  const c = document.createElement('canvas'); c.width = 4; c.height = 4;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, 0, 4, 1); x.fillRect(0, 2, 4, 0.6);
  _scan = ctx.createPattern(c, 'repeat'); return _scan;
}

function pad2(n) { n = Math.max(0, n | 0); return (n < 10 ? '0' : '') + n; }
function timecode(secs) {
  secs = Math.max(0, secs | 0);
  return pad2((secs / 60) | 0) + ':' + pad2(secs % 60);
}

// opts: { time, cam, code, flash (0..1), live, danger (0..1) }
export function drawSurveillance(ctx, W, H, opts = {}) {
  const time = opts.time || 0;
  const flash = opts.flash || 0;
  const danger = opts.danger || 0;

  ctx.save();

  // 1) RGB chroma-split punch (on a catch) — the "footage glitched" moment
  if (flash > 0.01) {
    ctx.globalCompositeOperation = 'screen';
    const off = 6 + flash * 10;
    ctx.globalAlpha = flash * 0.5;
    ctx.fillStyle = '#ff003c'; ctx.fillRect(-off, 0, W, H);
    ctx.fillStyle = '#00e5ff'; ctx.fillRect(off, 0, W, H);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // 2) phosphor-green monitor tint (stronger at the edges when in danger)
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = '#0fff7a'; ctx.globalAlpha = 0.16 + danger * 0.12;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

  // 3) scanlines
  const scan = buildScanlines(ctx);
  if (scan) { ctx.fillStyle = scan; ctx.fillRect(0, 0, W, H); }

  // 4) animated grain
  const noise = buildNoise();
  if (noise) {
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = 'overlay';
    const ox = ((time * 920) % 128) - 128, oy = ((time * 640) % 128) - 128;
    for (let yy = oy; yy < H; yy += 128) for (let xx = ox; xx < W; xx += 128) ctx.drawImage(noise, xx, yy);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  // 5) vignette
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,' + (0.42 + danger * 0.2).toFixed(2) + ')');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 6) cam HUD — REC dot, cam id, timecode, corner brackets, FEED line
  const phos = danger > 0.5 ? '#ff2e63' : '#39ff9d';
  ctx.font = '700 13px "Consolas", "Segoe UI", monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = phos; ctx.shadowBlur = 6;

  // brackets
  ctx.strokeStyle = 'rgba(57,255,157,0.45)'; ctx.lineWidth = 2; const b = 18, m = 14;
  const corner = (cx, cy, sx, sy) => { ctx.beginPath(); ctx.moveTo(cx, cy + sy * b); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * b, cy); ctx.stroke(); };
  corner(m, m, 1, 1); corner(W - m, m, -1, 1); corner(m, H - m, 1, -1); corner(W - m, H - m, -1, -1);

  // REC + cam id (top-left, under the bracket) — replay mode swaps the badge
  const blink = (Math.sin(time * 6) > -0.2);
  if (opts.replay) {
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('▶ REPLAY', m + 12, m + 35);
    ctx.fillStyle = phos;
    ctx.fillText(opts.cam || 'CAM-01', m + 92, m + 35);
  } else {
    if (opts.live !== false && blink) { ctx.fillStyle = '#ff2e3e'; ctx.beginPath(); ctx.arc(m + 16, m + 30, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = phos;
    ctx.fillText('REC', m + 28, m + 35);
    ctx.fillText(opts.cam || 'CAM-01', m + 70, m + 35);
  }

  // timecode (top-right)
  ctx.textAlign = 'right';
  ctx.fillText(opts.code || timecode(time), W - m - 14, m + 35);
  ctx.textAlign = 'left';

  // feed status (bottom-left)
  ctx.font = '700 11px "Consolas", monospace';
  ctx.fillStyle = opts.replay ? 'rgba(56,189,248,0.75)' : 'rgba(57,255,157,0.7)';
  ctx.fillText(
    opts.replay ? '▶ ARCHIVED FOOTAGE · RE-SIMULATION' : (danger > 0.5 ? '◉ SUBJECT FLAGGED' : '◉ LIVE FEED · BEHAVIORAL SCAN'),
    m + 14, H - m - 14);

  ctx.shadowBlur = 0;
  ctx.restore();
}
