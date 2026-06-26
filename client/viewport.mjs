// ============================================================
// HUMAN ERROR — responsive canvas fit
// Keeps the 960×600 logical drawing buffer but scales the canvas via CSS so it
// fits any viewport (phone landscape, small desktop window). Desktop windows at
// or above native size are left untouched (scale capped at 1).
// ============================================================

import { W, H } from '../engine/config.mjs';

export function fitCanvas(canvas, { logicalW = W, logicalH = H, maxScale = 1 } = {}) {
  let scale = 1;
  function fit() {
    const vw = (window.visualViewport ? window.visualViewport.width : window.innerWidth) || logicalW;
    const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) || logicalH;
    scale = Math.min(vw / logicalW, vh / logicalH, maxScale);
    canvas.style.width = Math.round(logicalW * scale) + 'px';
    canvas.style.height = Math.round(logicalH * scale) + 'px';
  }
  fit();
  addEventListener('resize', fit);
  addEventListener('orientationchange', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);

  return {
    fit,
    // Map a client (event) coordinate into logical 960×600 space — for tap-to-tag
    // and any future point-and-click input.
    toLogical(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return {
        x: (clientX - r.left) / (r.width || 1) * logicalW,
        y: (clientY - r.top) / (r.height || 1) * logicalH,
      };
    },
  };
}
