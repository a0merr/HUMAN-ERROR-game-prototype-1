// ============================================================
// HUMAN ERROR — auto-clip pipeline
// Rolling canvas recorder. TWO MediaRecorders run staggered by half the
// window (B starts 6s after A; each still cycles every 12s), so whichever
// one currently holds more footage always has ≥6s of pre-roll — a catch
// landing right after a cycle can no longer export a near-empty clip.
// On a catch (or a key press) the fuller segment is finalized and handed to
// an in-page share overlay (onSave) instead of force-downloading.
//
// The stream carries the game audio (sonar ping / catch sting / ambience)
// when the caller provides getAudioStream — see audio.mjs getRecordStream().
//
// Pure presentation/IO; never touches the sim. Degrades to a no-op when the
// browser lacks captureStream / MediaRecorder (the P-key screenshot still works).
// ============================================================

const SEG_MS = 12000;      // each recorder rolls to a fresh segment this often
const STAGGER_MS = 6000;   // offset between the two recorders = guaranteed pre-roll
const COOLDOWN_MS = 5000;  // min gap between exported clips (don't spam exports)

export class ClipRecorder {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.fps = opts.fps || 30;
    this.name = opts.gameName || 'human-error';
    this.getAudioStream = opts.getAudioStream || null;   // () => MediaStream with audio tracks
    this.onSave = opts.onSave || null;                   // (blob, filename) => true when handled
    this.stream = null;
    this.slots = [null, null];    // { rec, chunks, born }
    this.timers = [null, null];
    this.busy = false; this._lastCap = -1e9;
    this.supported = !!(canvas && canvas.captureStream && typeof window !== 'undefined' && window.MediaRecorder);
    this.lastLabel = '';
  }

  start() {
    if (!this.supported || this.stream) return;
    try {
      const video = this.canvas.captureStream(this.fps);
      let stream = video;
      // clips must carry SFX — merge the game's record tap into the canvas stream
      if (this.getAudioStream) {
        try {
          const a = this.getAudioStream();
          const at = a ? a.getAudioTracks() : [];
          if (at.length) stream = new MediaStream([...video.getVideoTracks(), ...at]);
        } catch (e) {}
      }
      this.stream = stream;
      this._begin(0);
      this.timers[1] = setTimeout(() => this._begin(1), STAGGER_MS);
    } catch (e) { this.supported = false; }
  }

  _pickMime() {
    const want = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of want) { try { if (window.MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return 'video/webm';
  }

  _begin(i) {
    if (!this.stream) return;
    let rec;
    try { rec = new MediaRecorder(this.stream, { mimeType: this._pickMime(), videoBitsPerSecond: 4_000_000 }); }
    catch (e) { this.supported = false; this.slots[i] = null; return; }
    const slot = { rec, chunks: [], born: (typeof performance !== 'undefined' ? performance.now() : 0) };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) slot.chunks.push(e.data); };
    try { rec.start(500); } catch (e) { this.supported = false; this.slots[i] = null; return; }
    this.slots[i] = slot;
    clearTimeout(this.timers[i]);
    this.timers[i] = setTimeout(() => this._cycle(i), SEG_MS);
  }

  // Roll slot i to a fresh segment so retained memory stays bounded.
  _cycle(i) {
    const slot = this.slots[i];
    if (!slot) { this._begin(i); return; }
    if (this.busy) { this.timers[i] = setTimeout(() => this._cycle(i), 1000); return; }
    slot.rec.onstop = () => { if (!this.busy) this._begin(i); };
    try { slot.rec.stop(); } catch (e) { this._begin(i); }
  }

  // Finalize whichever recorder currently holds MORE footage (the stagger
  // guarantees it has ≥ STAGGER_MS of pre-roll) and hand the blob over.
  capture(label = 'clip') {
    if (!this.supported || this.busy) return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (now - this._lastCap < COOLDOWN_MS) return false;
    let best = -1, age = -1;
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (s && s.rec.state === 'recording' && now - s.born > age) { age = now - s.born; best = i; }
    }
    if (best < 0) return false;
    this._lastCap = now; this.busy = true; this.lastLabel = label;
    clearTimeout(this.timers[0]); clearTimeout(this.timers[1]);
    const slot = this.slots[best], other = 1 - best;
    slot.rec.onstop = () => {
      try {
        const blob = new Blob(slot.chunks, { type: (slot.chunks[0] && slot.chunks[0].type) || 'video/webm' });
        if (blob.size) this._save(blob, label);
      } catch (e) {}
      this.busy = false;
      // restart the captured slot now and re-stagger the other, so a capture
      // never collapses the two buffers onto the same phase
      this._begin(best);
      clearTimeout(this.timers[other]);
      this.timers[other] = setTimeout(() => this._cycle(other), STAGGER_MS);
    };
    try { if (slot.rec.requestData) slot.rec.requestData(); } catch (e) {}
    try { slot.rec.stop(); } catch (e) { this.busy = false; this._begin(best); }
    return true;
  }

  _save(blob, label) {
    const stamp = Math.floor((typeof performance !== 'undefined' ? performance.now() : 0));
    const filename = `${this.name}-${label}-${stamp}.webm`;
    let handled = false;
    if (this.onSave) { try { handled = !!this.onSave(blob, filename); } catch (e) {} }
    if (!handled) this._download(blob, filename);
  }

  _download(blob, filename) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {}
  }

  stop() {
    clearTimeout(this.timers[0]); clearTimeout(this.timers[1]);
    for (const s of this.slots) { try { if (s) { s.rec.onstop = null; s.rec.stop(); } } catch (e) {} }
    this.slots = [null, null];
  }
}
