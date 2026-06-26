// ============================================================
// HUMAN ERROR — canvas renderer
// Pure presentation: draws a CrowdSim snapshot. Shared by solo + mp client.
// ============================================================

import { ARENA, BODY_R, BODY_SHAPES, POSE, PALETTE, SKINS, W, H } from '../engine/config.mjs';
import { clamp } from '../engine/math.mjs';
import { drawSurveillance } from './style.mjs';
import { drawFigure } from './figure.mjs';

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
  }

  _roundRect(x, y, w, h, r) {
    const c = this.ctx;
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  drawPerson(a, isHunter, skinIdx = 0) {
    const ctx = this.ctx;
    const skin = SKINS[skinIdx] || SKINS[0];
    const moving = Math.hypot(a.vx, a.vy) > 4;
    const dancing = a.pose === POSE.DANCE;
    const locked = isHunter && a.target && a.target.isPlayer;
    drawFigure(ctx, {
      x: a.x, y: a.y, facing: a.facing, moving, dancing,
      phase: a.animPhase, seed: 0, dancePhase: a.dancePhase, shapeIdx: a.shape || 0,
      bodyCol: isHunter ? (locked ? PALETTE.pink : '#3aa0ff') : skin.body,
      headCol: isHunter ? '#cfe6ff' : skin.head,
      darkCol: isHunter ? '#0a1422' : skin.dark,
      isHunter,
    });
    // TELL marker — the product. A body mid-"slip" (acting too human) gets a
    // loud, pulsing callout so the joke reads at a glance / on a stream clip.
    if (a.slipping && a.slip) {
      const ico = { sprint: '💨', flinch: '😱', overdance: '🤪', bunch: '👀' }[a.slip] || '⚠️';
      const pulse = 0.5 + 0.5 * Math.sin(a.animPhase * 16);
      ctx.save(); ctx.translate(a.x, a.y);
      ctx.shadowColor = PALETTE.pink; ctx.shadowBlur = 12 + pulse * 6;   // glow survives downscaling into clips/thumbnails
      ctx.globalAlpha = 0.55 + 0.4 * pulse; ctx.strokeStyle = PALETTE.pink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -2, 16 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.shadowBlur = 6; ctx.font = '16px "Segoe UI Emoji", Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(ico, 0, -27);
      ctx.restore();
    }
    // taunt emote bubble (multiplayer flavor / clip surface)
    if (a.tauntT > 0) {
      ctx.save(); ctx.translate(a.x, a.y);
      ctx.globalAlpha = clamp(a.tauntT, 0, 1);
      ctx.font = '16px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(['👋', '🕺', '😎', '🔥'][a.taunt % 4], 0, -24);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // view: { player, hunters, perks:Set, killcam, shake, particles, labelPlayer, maxLock }
  render(sim, view = {}) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    const shake = view.shake || 0;
    if (shake > 0.2) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    const kc = view.killcam;
    if (kc) {
      const e = clamp(kc.t / 0.5, 0, 1), ez = 1 - Math.pow(1 - e, 3), zoom = 1 + 1.6 * ez;
      ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-kc.x, -kc.y);
    }

    // floor + grid + intersection nodes (tech-floor read)
    ctx.fillStyle = PALETTE.arena; ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.strokeStyle = PALETTE.grid; ctx.lineWidth = 1;
    for (let gx = ARENA.x; gx <= ARENA.x + ARENA.w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, ARENA.y); ctx.lineTo(gx, ARENA.y + ARENA.h); ctx.stroke(); }
    for (let gy = ARENA.y; gy <= ARENA.y + ARENA.h; gy += 40) { ctx.beginPath(); ctx.moveTo(ARENA.x, gy); ctx.lineTo(ARENA.x + ARENA.w, gy); ctx.stroke(); }
    ctx.fillStyle = 'rgba(120,160,210,.06)';
    for (let gx = ARENA.x; gx <= ARENA.x + ARENA.w; gx += 40)
      for (let gy = ARENA.y; gy <= ARENA.y + ARENA.h; gy += 40) ctx.fillRect(gx - 1, gy - 1, 2, 2);

    // glitch zone hints
    const g = sim.glitch;
    if (g) {
      if (g.type === 'cash') { ctx.fillStyle = 'rgba(245,185,66,.18)'; ctx.beginPath(); ctx.arc(W / 2, ARENA.y + ARENA.h / 2, 42, 0, Math.PI * 2); ctx.fill(); }
      else if (g.type === 'alarm') { ctx.fillStyle = 'rgba(255,46,99,.10)'; ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h); }
    }

    // vision cones (AI hunters + any human hunter agents)
    const coneHolders = [...sim.hunters, ...sim.agents.filter(a => a.role === 'hunter' && a.scanR)];
    for (const h of coneHolders) {
      ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.facing);
      const grd = ctx.createRadialGradient(0, 0, 10, 0, 0, h.scanR);
      const hot = h.target ? 'rgba(255,46,99,0.24)' : 'rgba(58,160,255,0.15)';
      grd.addColorStop(0, hot); grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, h.scanR, -h.scanHalf, h.scanHalf); ctx.closePath(); ctx.fill();
      // radar sweep line — a scanning beam crossing the cone
      const sw = Math.sin(sim.time * 2.1 + h.x * 0.02) * 0.5 + 0.5;
      const ang = -h.scanHalf + sw * 2 * h.scanHalf;
      ctx.strokeStyle = h.target ? 'rgba(255,46,99,.5)' : 'rgba(90,180,255,.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * h.scanR, Math.sin(ang) * h.scanR); ctx.stroke();
      ctx.restore();
    }

    // pillars — depth via drop shadow + inner shade + lip highlight
    for (const p of sim.pillars) {
      ctx.fillStyle = 'rgba(0,0,0,.30)'; this._roundRect(p.x + 3, p.y + 5, p.w, p.h, 7); ctx.fill();
      ctx.fillStyle = '#1c2942'; this._roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.22)'; this._roundRect(p.x + 2, p.y + p.h * 0.5, p.w - 4, p.h * 0.5 - 3, 5); ctx.fill();
      ctx.fillStyle = 'rgba(120,170,230,.10)'; this._roundRect(p.x + 3, p.y + 3, p.w - 6, 7, 3); ctx.fill();
      ctx.strokeStyle = '#34507a'; ctx.lineWidth = 2; this._roundRect(p.x, p.y, p.w, p.h, 6); ctx.stroke();
    }

    // decoys
    for (const d of sim.decoys) {
      ctx.globalAlpha = clamp(d.t, 0, 1) * 0.8;
      ctx.fillStyle = PALETTE.blue; ctx.beginPath(); ctx.arc(d.x, d.y, BODY_R, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = '#243149'; ctx.lineWidth = 2; ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

    // crowd (non-hunter agents), back-to-front
    const player = view.player;
    const crowd = sim.agents.filter(a => a.role !== 'hunter' && a !== player).slice().sort((p, q) => p.y - q.y);
    for (const a of crowd) this.drawPerson(a, false, a.skin || 0);

    // local player highlight
    if (player) {
      this.drawPerson(player, player.role === 'hunter', player.skin || 0);
      if (view.labelPlayer) {
        ctx.beginPath(); ctx.strokeStyle = 'rgba(43,212,121,.9)'; ctx.lineWidth = 2;
        ctx.arc(player.x, player.y, BODY_R + 7, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(43,212,121,.95)'; ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText('YOU', player.x, player.y - BODY_R - 16);
        const lk = view.maxLock || 0;
        if (lk > 0.02) {
          ctx.beginPath(); ctx.strokeStyle = 'rgba(255,46,99,.9)'; ctx.lineWidth = 3;
          ctx.arc(player.x, player.y, BODY_R + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lk); ctx.stroke();
        }
      }
    }

    // hunters on top
    const perks = view.perks;
    for (const h of coneHolders) {
      if (perks && perks.has && perks.has('radar') && h.target && h.target.x !== undefined) {
        ctx.strokeStyle = 'rgba(255,46,99,.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.target.x, h.target.y); ctx.stroke(); ctx.setLineDash([]);
      }
      if (h !== player) this.drawPerson(h, true, 0);
    }

    // particles
    const particles = view.particles || [];
    for (const p of particles) { ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }
    ctx.globalAlpha = 1;

    if (kc) {
      const pulse = 2 + Math.sin(kc.t * 12) * 1.2;
      ctx.beginPath(); ctx.strokeStyle = 'rgba(255,46,99,.95)'; ctx.lineWidth = pulse;
      ctx.arc(kc.x, kc.y, BODY_R + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // surveillance post-FX (screen space — stamps the gameplay AND the clips)
    if (view.surveil) drawSurveillance(ctx, W, H, view.surveil);

    if (kc && kc.t > 0.45) {
      const a = clamp((kc.t - 0.45) / 0.3, 0, 1);
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.pink; ctx.font = '900 64px Segoe UI'; ctx.fillText('HUMAN ERROR', W / 2, H / 2 - 8);
      ctx.fillStyle = PALETTE.ink; ctx.font = '700 20px Segoe UI'; ctx.fillText(kc.label || 'CAUGHT — too human.', W / 2, H / 2 + 30);
      ctx.restore();
    }
  }
}

// Visual-only particle field (client side; never part of sim state).
export class Particles {
  constructor() { this.list = []; }
  burst(x, y, color, n = 18) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 190;
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.55, color });
    }
  }
  // soft, slow, upward-drifting dust (footsteps) — gentler than burst
  puff(x, y, color, n = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 8 + Math.random() * 20;
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 12, life: 0.3 + Math.random() * 0.3, color });
    }
  }
  step(dt) {
    for (const p of this.list) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
    this.list = this.list.filter(p => p.life > 0);
  }
}
