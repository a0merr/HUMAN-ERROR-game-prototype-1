// ============================================================
// HUMAN ERROR — shared character figure
// One richer body renderer used by BOTH the solo (render.mjs) and the
// multiplayer (mp.mjs) clients, so the crowd looks identical everywhere and
// the two never drift. Pure canvas drawing; no sim state.
//
// Upgrades over the old inline blobs: volume shading (top highlight + bottom
// shade), a thin dark outline so figures read on the green feed, a head
// glint, rounded weighted limbs, a real alternating walk cycle, idle breathing,
// and a livelier dance. Body silhouette still comes from BODY_SHAPES.
// ============================================================

import { BODY_SHAPES } from '../engine/config.mjs';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// o: { x, y, facing, moving, dancing, phase, seed, dancePhase, shapeIdx,
//      bodyCol, headCol, darkCol, isHunter }
// Returns the body bob offset so callers can place markers (tell/taunt) cleanly.
export function drawFigure(ctx, o) {
  const bs = BODY_SHAPES[o.shapeIdx || 0] || BODY_SHAPES[0];
  const phase = o.phase || 0, seed = o.seed || 0;
  const moving = !!o.moving, dancing = !!o.dancing;
  const body = o.bodyCol, head = o.headCol, dark = o.darkCol;

  ctx.save(); ctx.translate(o.x, o.y);

  // grounded soft shadow (drawn before the silhouette scale so it stays planted)
  ctx.fillStyle = 'rgba(0,0,0,.34)';
  ctx.beginPath(); ctx.ellipse(0, 12, 8.5 * bs.sx, 3, 0, 0, Math.PI * 2); ctx.fill();

  // hunters keep shape 0 so the rotated muzzle never distorts
  if (!o.isHunter) ctx.scale(bs.bw / 10, bs.bh / 12);

  const walk = Math.sin(phase * 11 + seed);
  const bob = dancing ? Math.sin(o.dancePhase || 0) * 1.9
    : (moving ? Math.abs(walk) * 0.9 : Math.sin(phase * 2.2 + seed) * 0.55);
  const breathe = (!moving && !dancing) ? (0.5 + 0.5 * Math.sin(phase * 2.2 + seed)) * 0.5 : 0;

  // ---- legs (rounded, alternating) ----
  ctx.strokeStyle = dark; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  const legK = moving ? walk * 3.4 : 0;
  ctx.beginPath(); ctx.moveTo(-2.6, 4 + bob); ctx.lineTo(-3.2 + legK * 0.4, 11.5 + legK); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2.6, 4 + bob); ctx.lineTo(3.2 - legK * 0.4, 11.5 - legK); ctx.stroke();

  // ---- torso with volume shading + outline ----
  const bh = 12 + breathe;
  ctx.fillStyle = body; rr(ctx, -5, -6 + bob, 10, bh, 4); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.16)'; rr(ctx, -4, -5 + bob, 8, 3.6, 2); ctx.fill();   // top highlight
  ctx.fillStyle = 'rgba(0,0,0,.18)'; rr(ctx, -5, 1.4 + bob, 10, bh - 7.4, 3); ctx.fill();  // lower shade
  ctx.strokeStyle = dark; ctx.lineWidth = 1; rr(ctx, -5, -6 + bob, 10, bh, 4); ctx.stroke();

  // ---- arms ----
  ctx.strokeStyle = body; ctx.lineWidth = 3.1; ctx.lineCap = 'round';
  if (dancing) {
    const w = Math.sin((o.dancePhase || 0) * 1.5) * 0.5;
    ctx.beginPath(); ctx.moveTo(-4, -3 + bob); ctx.lineTo(-8, -9 + w * 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -3 + bob); ctx.lineTo(8, -9 - w * 3); ctx.stroke();
  } else if (moving) {
    const a2 = walk * 3;   // arms counter-swing the legs
    ctx.beginPath(); ctx.moveTo(-4, -2 + bob); ctx.lineTo(-5.4, 3 + a2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -2 + bob); ctx.lineTo(5.4, 3 - a2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(-4, -2 + bob); ctx.lineTo(-5, 3.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -2 + bob); ctx.lineTo(5, 3.2); ctx.stroke();
  }

  // ---- head with outline + glint ----
  ctx.fillStyle = head; ctx.beginPath(); ctx.arc(0, -10 + bob, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.arc(-1.7, -11.4 + bob, 1.5, 0, Math.PI * 2); ctx.fill();

  // ---- hunter muzzle ----
  if (o.isHunter) {
    ctx.fillStyle = 'rgba(10,20,35,.92)'; ctx.save(); ctx.translate(0, -10 + bob); ctx.rotate(o.facing || 0);
    rr(ctx, 1, -2.4, 4.6, 4.8, 1.5); ctx.fill(); ctx.restore();
  }

  ctx.restore();
  return bob;
}
