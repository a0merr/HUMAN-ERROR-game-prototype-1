// ============================================================
// HUMAN ERROR — tiny WebAudio sfx (no assets, generated on the fly)
// ============================================================

let actx = null;

export function initAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

export function beep(freq, dur, type = 'sine', vol = 0.06) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(actx.destination);
  const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur);
}

// Named cues so gameplay code reads cleanly.
export const sfx = {
  glitch() { beep(170, 0.25, 'sawtooth', 0.08); },
  react()  { beep(680, 0.08, 'triangle', 0.05); },
  catch()  { beep(220, 0.12, 'sawtooth'); setTimeout(() => beep(140, 0.25, 'sawtooth'), 120); },
  bot()    { beep(160, 0.1, 'square', 0.06); setTimeout(() => beep(110, 0.18, 'sawtooth', 0.05), 90); },
  decoy()  { beep(520, 0.12, 'triangle', 0.06); },
  clear()  { beep(523, 0.1, 'triangle'); setTimeout(() => beep(784, 0.16, 'triangle'), 110); },
  tickLow(n) { beep(440 + (10 - n) * 40, 0.05, 'square', 0.04); },
  heart(intensity) { beep(60, 0.12, 'sine', 0.05 * intensity); },
  taunt(i) { beep([523, 659, 784, 880][i % 4], 0.12, 'triangle', 0.05); },
  tell()   { beep(990, 0.05, 'triangle', 0.035); },   // faint "tell" blip when a body slips nearby
};
