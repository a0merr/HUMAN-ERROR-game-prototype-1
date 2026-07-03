// ============================================================
// HUMAN ERROR — keyboard input
// Tracks held keys and turns them into a movement intent the sim understands.
// Also exposes one-shot action callbacks (taunt, decoy, react, screenshot).
// ============================================================

export class Input {
  constructor() {
    this.keys = {};
    this.handlers = {};   // name -> fn
    this.move = { ix: 0, iy: 0 };   // analog touch stick (-1..1), merged into intent
    this.touchSlow = false;         // virtual "blend" (slow walk) from a touch button
    this.touchDance = false;        // virtual dance hold from a touch button
    this._down = (e) => {
      const k = e.key.toLowerCase();
      const wasUp = !this.keys[k];
      this.keys[k] = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (wasUp) this._fire(k, e);
    };
    this._up = (e) => { this.keys[e.key.toLowerCase()] = false; };
  }

  attach() { addEventListener('keydown', this._down); addEventListener('keyup', this._up); return this; }
  detach() { removeEventListener('keydown', this._down); removeEventListener('keyup', this._up); return this; }

  on(name, fn) { this.handlers[name] = fn; return this; }

  // Touch hooks — let the on-screen controls drive the same intent/actions.
  setMove(ix, iy) { this.move.ix = ix; this.move.iy = iy; }
  setSlow(v) { this.touchSlow = !!v; }
  setDance(v) { this.touchDance = !!v; }
  trigger(name) { const h = this.handlers[name]; if (h) h(); }

  _fire(k, e) {
    const h = this.handlers;
    if (k === 'enter' && h.enter) h.enter(e);
    if (k === 'q' && h.decoy) h.decoy();
    if (k === 'p' && h.screenshot) h.screenshot();
    if (k === 'c' && h.clip) h.clip();
    if ((k === ' ' || k === 'e') && h.react) h.react();
    if (k === ' ' && h.tag) h.tag();
    if (/^[1-4]$/.test(k) && h.taunt) h.taunt(parseInt(k, 10) - 1);
  }

  // Movement intent for the active player.
  intent({ sprintPerk = false } = {}) {
    const k = this.keys;
    let ix = 0, iy = 0;
    if (k['a'] || k['arrowleft']) ix -= 1;
    if (k['d'] || k['arrowright']) ix += 1;
    if (k['w'] || k['arrowup']) iy -= 1;
    if (k['s'] || k['arrowdown']) iy += 1;
    // analog touch stick adds in; applyHumanIntent normalizes direction
    ix += this.move.ix; iy += this.move.iy;
    const slow = !!k['shift'] || this.touchSlow;
    const speed = slow ? 58 : (sprintPerk ? 175 : 140);
    return { ix, iy, slow, dance: !!k['f'] || this.touchDance, speed };
  }
}
