// ============================================================
// HUMAN ERROR — auto-clip pipeline
// Rolling canvas recorder. Keeps the last ~12s of gameplay in a single valid
// WebM segment; on a catch (or a key press) it finalizes that segment and
// downloads a shareable clip. The whole realistic distribution plan for this
// game is short-form clips — so the game manufactures them with zero effort.
//
// Pure presentation/IO; never touches the sim. Degrades to a no-op when the
// browser lacks captureStream / MediaRecorder (the P-key screenshot still works).
// ============================================================

const SEG_MS = 12000;      // roll to a fresh segment at least this often (bounds memory + lead length)
const COOLDOWN_MS = 5000;  // min gap between exported clips (don't spam downloads)

export class ClipRecorder {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.fps = opts.fps || 30;
    this.name = opts.gameName || 'human-error';
    this.rec = null; this.stream = null; this.chunks = [];
    this.busy = false; this._lastCap = -1e9; this._timer = null;
    this.supported = !!(canvas && canvas.captureStream && typeof window !== 'undefined' && window.MediaRecorder);
    this.lastLabel = '';
  }

  start() {
    if (!this.supported || this.rec) return;
    try { this.stream = this.canvas.captureStream(this.fps); this._begin(); }
    catch (e) { this.supported = false; }
  }

  _pickMime() {
    const want = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of want) { try { if (window.MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return 'video/webm';
  }

  _begin() {
    if (!this.stream) return;
    try {
      this.chunks = [];
      this.rec = new MediaRecorder(this.stream, { mimeType: this._pickMime(), videoBitsPerSecond: 4_000_000 });
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.start(500);
    } catch (e) { this.supported = false; this.rec = null; return; }
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._cycle(), SEG_MS);
  }

  // Roll to a fresh segment so retained memory (and the WebM header chain) stays bounded.
  _cycle() {
    if (!this.rec || this.busy) { this._timer = setTimeout(() => this._cycle(), SEG_MS); return; }
    const r = this.rec;
    r.onstop = () => { if (!this.busy) this._begin(); };
    try { r.stop(); } catch (e) { this._begin(); }
  }

  // Finalize the current segment (the seconds leading up to NOW) and download it.
  capture(label = 'clip') {
    if (!this.supported || !this.rec || this.busy) return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (now - this._lastCap < COOLDOWN_MS) return false;
    this._lastCap = now; this.busy = true; this.lastLabel = label;
    clearTimeout(this._timer);
    const r = this.rec;
    r.onstop = () => {
      try {
        const blob = new Blob(this.chunks, { type: (this.chunks[0] && this.chunks[0].type) || 'video/webm' });
        if (blob.size) this._download(blob, label);
      } catch (e) {}
      this.busy = false; this._begin();
    };
    try { if (r.requestData) r.requestData(); } catch (e) {}
    try { r.stop(); } catch (e) { this.busy = false; this._begin(); }
    return true;
  }

  _download(blob, label) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = Math.floor((typeof performance !== 'undefined' ? performance.now() : 0));
      a.href = url; a.download = `${this.name}-${label}-${stamp}.webm`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {}
  }

  stop() {
    clearTimeout(this._timer);
    try { if (this.rec) { this.rec.onstop = null; this.rec.stop(); } } catch (e) {}
    this.rec = null;
  }
}
