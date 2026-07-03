// ============================================================
// HUMAN ERROR — HUD / DOM glue
// Thin wrapper over the overlay + meter DOM. Used by the solo entry; the
// multiplayer entry reuses the generic bits (timer, glitch, feed, vignette).
// ============================================================

import { clamp } from '../engine/math.mjs';

const $ = (id) => document.getElementById(id);

// ---------- clip share overlay ----------
// Small dismissible card with a looping preview + Share / Download / Dismiss.
// Used as the ClipRecorder onSave hook by both entries; returns false when the
// page carries no overlay markup so the recorder falls back to a download.
let clipUrl = null, clipTimer = null;

function downloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {}
}

export function presentClip(blob, filename) {
  const ov = $('clipOverlay');
  const vid = $('clipVideo');
  if (!ov || !vid) return false;
  if (clipUrl) { try { URL.revokeObjectURL(clipUrl); } catch (e) {} }
  clipUrl = URL.createObjectURL(blob);
  vid.src = clipUrl;
  try { const pl = vid.play(); if (pl && pl.catch) pl.catch(() => {}); } catch (e) {}
  ov.classList.remove('hidden');
  const dismiss = () => { clearTimeout(clipTimer); ov.classList.add('hidden'); try { vid.pause(); } catch (e) {} };
  clearTimeout(clipTimer);
  clipTimer = setTimeout(dismiss, 8000);   // auto-dismiss so it never blocks play
  $('clipDismiss').onclick = dismiss;
  $('clipDownload').onclick = () => { downloadBlob(blob, filename); dismiss(); };
  $('clipShare').onclick = async () => {
    clearTimeout(clipTimer);   // user is interacting — don't yank the card away
    try {
      const file = new File([blob], filename, { type: blob.type || 'video/webm' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'HUMAN ERROR', text: 'One of us is real.' });
        dismiss(); return;
      }
    } catch (e) { if (e && e.name === 'AbortError') { dismiss(); return; } }
    downloadBlob(blob, filename); dismiss();
  };
  return true;
}

export class Hud {
  constructor() {
    this.timer = $('timer');
    this.timerLabel = $('timerLabel');
    this.wave = $('waveTag');
    this.susp = $('suspFill');
    this.glitch = $('glitch');
    this.vignette = $('vignette');
    this.feedEl = $('feed');
    this.startScreen = $('startScreen');
    this.endScreen = $('endScreen');
    this.perkScreen = $('perkScreen');
    this.perkOpts = $('perkOpts');
    this.perkWave = $('perkWave');
    this.endTitle = $('endTitle');
    this.endSub = $('endSub');
    this.endFlavor = $('endFlavor');
    this.endStats = $('endStats');
    this.combo = $('combo');
    this.metaLine = $('metaLine');
    this.coach = $('coach');
    this.coachTitle = $('coachTitle');
    this.coachText = $('coachText');
    this.feedItems = [];
  }

  showCoach(title, text) {
    if (!this.coach) return;
    if (this.coachTitle) this.coachTitle.textContent = title || '';
    if (this.coachText) this.coachText.innerHTML = text || '';
    this.coach.classList.add('show');
  }
  hideCoach() { if (this.coach) this.coach.classList.remove('show'); }

  setCombo(n) {
    if (!this.combo) return;
    if (n >= 2) { this.combo.textContent = 'COMBO ×' + n; this.combo.style.opacity = '1'; }
    else this.combo.style.opacity = '0';
  }
  setMeta(html) { if (this.metaLine) this.metaLine.innerHTML = html || ''; }

  setTimer(n) { if (this.timer) this.timer.textContent = n; }
  setTimerLabel(s) { if (this.timerLabel) this.timerLabel.textContent = s; }
  setWave(s) { if (this.wave) this.wave.textContent = s; }
  setSuspicion(pct) { if (this.susp) this.susp.style.width = pct.toFixed(1) + '%'; }
  setVignette(o) { if (this.vignette) this.vignette.style.opacity = o.toFixed(2); }

  showGlitch(g) { if (this.glitch) { this.glitch.innerHTML = g.name + '<small>' + g.sub + '</small>'; this.glitch.style.opacity = '1'; } }
  hideGlitch() { if (this.glitch) this.glitch.style.opacity = '0'; }

  feed(msg) {
    this.feedItems.unshift({ msg, t: 2.6 });
    if (this.feedItems.length > 4) this.feedItems.pop();
    this._renderFeed();
  }
  stepFeed(dt) {
    if (!this.feedItems.length) return;
    let dirty = false;
    for (const f of this.feedItems) { f.t -= dt; if (f.t < 0.6) dirty = true; }
    const before = this.feedItems.length;
    this.feedItems = this.feedItems.filter(f => f.t > 0);
    if (dirty || this.feedItems.length !== before) this._renderFeed();
  }
  _renderFeed() {
    if (!this.feedEl) return;
    this.feedEl.innerHTML = this.feedItems
      .map(f => `<div style="opacity:${clamp(f.t / 2.6, 0, 1).toFixed(2)}">${f.msg}</div>`).join('');
  }

  hideOverlays() {
    this.startScreen && this.startScreen.classList.add('hidden');
    this.endScreen && this.endScreen.classList.add('hidden');
    this.perkScreen && this.perkScreen.classList.add('hidden');
  }

  showPerks(waveNum, perks, onPick) {
    if (!this.perkScreen) return;
    if (this.perkWave) this.perkWave.textContent = 'WAVE ' + waveNum + ' CLEARED';
    this.perkOpts.innerHTML = '';
    for (const p of perks) {
      const b = document.createElement('button');
      b.className = 'perkCard';
      b.innerHTML = `<b>${p.name}</b><span>${p.desc}</span>`;
      b.onclick = () => onPick(p.id);
      this.perkOpts.appendChild(b);
    }
    this.perkScreen.classList.remove('hidden');
  }
  hidePerks() { this.perkScreen && this.perkScreen.classList.add('hidden'); }

  showEnd({ title, sub, statsHtml, flavor, win }) {
    if (!this.endScreen) return;
    this.endScreen.classList.remove('hidden', 'win', 'lose');
    this.endScreen.classList.add(win ? 'win' : 'lose');
    if (this.endTitle) this.endTitle.textContent = title;
    if (this.endSub) this.endSub.textContent = sub;
    if (this.endStats) this.endStats.innerHTML = statsHtml || '';
    if (this.endFlavor) this.endFlavor.textContent = flavor || '';
  }
}
