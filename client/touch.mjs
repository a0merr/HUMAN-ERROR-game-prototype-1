// ============================================================
// HUMAN ERROR — touch controls
// A floating virtual joystick (left) + tappable action buttons (right) so the
// game is playable on phones — the front door for clip-driven mobile traffic.
// Self-contained: builds its own DOM + CSS, and only activates on touch /
// coarse-pointer devices so desktop is completely unaffected.
//
//   makeTouchControls({
//     onMove(ix, iy),                 // analog stick, -1..1, (0,0) on release
//     actions: [
//       { label, hold?, onDown(), onUp() }   // hold = press-and-hold button
//     ],
//   }) -> { show(), hide(), isTouch }
// ============================================================

const STICK_R = 56;   // px radius the thumb travels before clamping to full tilt

export function isTouchDevice() {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  #touchUI { position: fixed; inset: 0; z-index: 40; display: none; touch-action: none;
    -webkit-user-select: none; user-select: none; pointer-events: none; }
  #touchUI.on { display: block; }
  .tc-stickZone { position: absolute; left: 0; top: 0; bottom: 0; width: 50%; pointer-events: auto; }
  .tc-base { position: absolute; width: ${STICK_R * 2}px; height: ${STICK_R * 2}px; margin: ${-STICK_R}px 0 0 ${-STICK_R}px;
    border-radius: 50%; background: rgba(20,28,42,.42); border: 2px solid rgba(120,160,210,.35);
    box-shadow: 0 4px 20px rgba(0,0,0,.4); display: none; }
  .tc-base.on { display: block; }
  .tc-thumb { position: absolute; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
    background: rgba(43,212,121,.85); box-shadow: 0 2px 14px rgba(43,212,121,.5); }
  .tc-actions { position: absolute; right: max(18px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom));
    display: flex; flex-direction: row-reverse; flex-wrap: wrap-reverse; gap: 12px; width: 232px; justify-content: flex-start; pointer-events: none; }
  .tc-btn { pointer-events: auto; min-width: 66px; height: 66px; padding: 0 10px; border-radius: 50%;
    background: rgba(20,28,42,.78); border: 1px solid #2c3e5e; color: #e8edf5;
    font: 800 12px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: .04em; text-align: center;
    display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 16px rgba(0,0,0,.45); }
  .tc-btn.tc-down { transform: scale(.92); border-color: #2bd479; background: rgba(43,212,121,.25); }
  .tc-rotate { position: fixed; inset: 0; z-index: 60; display: none; align-items: center; justify-content: center;
    flex-direction: column; gap: 12px; text-align: center; background: rgba(8,11,18,.96); color: #e8edf5;
    font: 700 18px "Segoe UI", system-ui, sans-serif; padding: 32px; }
  .tc-rotate.on { display: flex; }
  .tc-rotate .ico { font-size: 52px; animation: tcRot 1.8s ease-in-out infinite; }
  .tc-rotate small { color: #8b97a8; font-weight: 500; }
  @keyframes tcRot { 0%,40% { transform: rotate(0); } 60%,100% { transform: rotate(90deg); } }
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

export function makeTouchControls({ onMove = () => {}, actions = [] } = {}) {
  if (!isTouchDevice()) {
    return { show() {}, hide() {}, isTouch: false };
  }
  injectStyles();
  // stop the page from scrolling / pinch-zooming under the controls
  document.documentElement.style.touchAction = 'none';
  document.body.style.touchAction = 'none';

  const ui = document.createElement('div');
  ui.id = 'touchUI';

  // --- joystick ---
  const zone = document.createElement('div'); zone.className = 'tc-stickZone';
  const base = document.createElement('div'); base.className = 'tc-base';
  const thumb = document.createElement('div'); thumb.className = 'tc-thumb';
  base.appendChild(thumb); zone.appendChild(base); ui.appendChild(zone);

  let stickId = null, ox = 0, oy = 0;
  function place(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
  function stickStart(e) {
    if (stickId !== null) return;
    stickId = e.pointerId; ox = e.clientX; oy = e.clientY;
    place(base, ox, oy); place(thumb, STICK_R, STICK_R);
    base.classList.add('on');
    try { zone.setPointerCapture(stickId); } catch (_) {}
    e.preventDefault();
  }
  function stickMove(e) {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const d = Math.hypot(dx, dy) || 1;
    const cl = Math.min(d, STICK_R);
    const tx = dx / d * cl, ty = dy / d * cl;
    place(thumb, STICK_R + tx, STICK_R + ty);
    onMove(tx / STICK_R, ty / STICK_R);
    e.preventDefault();
  }
  function stickEnd(e) {
    if (e.pointerId !== stickId) return;
    stickId = null; base.classList.remove('on'); onMove(0, 0);
  }
  zone.addEventListener('pointerdown', stickStart);
  zone.addEventListener('pointermove', stickMove);
  zone.addEventListener('pointerup', stickEnd);
  zone.addEventListener('pointercancel', stickEnd);

  // --- action buttons ---
  const acts = document.createElement('div'); acts.className = 'tc-actions';
  for (const a of actions) {
    const b = document.createElement('div'); b.className = 'tc-btn'; b.textContent = a.label;
    let held = false;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); held = true; b.classList.add('tc-down');
      if (a.onDown) a.onDown();
    });
    const release = () => { if (!held) return; held = false; b.classList.remove('tc-down'); if (a.hold && a.onUp) a.onUp(); };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointerleave', release);
    b.addEventListener('pointercancel', release);
    acts.appendChild(b);
  }
  ui.appendChild(acts);
  document.body.appendChild(ui);

  // --- rotate-to-landscape nudge ---
  const rotate = document.createElement('div'); rotate.className = 'tc-rotate';
  rotate.innerHTML = '<div class="ico">📱</div><div>Rotate to landscape</div><small>HUMAN ERROR plays best sideways.</small>';
  document.body.appendChild(rotate);
  let visible = false;
  function updateRotate() {
    const portrait = window.matchMedia && matchMedia('(orientation: portrait)').matches;
    rotate.classList.toggle('on', visible && !!portrait);
  }
  addEventListener('resize', updateRotate);
  addEventListener('orientationchange', updateRotate);

  return {
    isTouch: true,
    show() { visible = true; ui.classList.add('on'); updateRotate(); },
    hide() { visible = false; ui.classList.remove('on'); rotate.classList.remove('on'); onMove(0, 0); },
  };
}
