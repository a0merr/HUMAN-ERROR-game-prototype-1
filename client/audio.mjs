// ============================================================
// HUMAN ERROR — tiny WebAudio sfx (no assets, generated on the fly)
// ============================================================

let actx = null, ambient = null, master = null, muteGain = null, recDest = null;

// Mute state is read at module load so the graph is born muted when the user
// left it that way — ambience never gets a frame of sound on boot.
let muted = false;
try { muted = localStorage.getItem('humanError.muted') === '1'; } catch (e) {}

// Master graph: every source -> master -> muteGain -> speakers.
// Clip recording taps `master` (BEFORE muteGain), so muted gameplay still
// records unmuted audio into exported clips.
function bus() {
  if (!actx) return null;
  if (!master) {
    master = actx.createGain();
    muteGain = actx.createGain();
    muteGain.gain.value = muted ? 0 : 1;
    master.connect(muteGain);
    muteGain.connect(actx.destination);
  }
  return master;
}

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('humanError.muted', muted ? '1' : '0'); } catch (e) {}
  if (muteGain) muteGain.gain.value = muted ? 0 : 1;
}
export function isMuted() { return muted; }

export function initAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  startAmbience();
  return actx;
}

// Audio track for clip exports. Lazy-creates the context so the recorder can
// wire up before the first user gesture; the track is simply silent until the
// context resumes.
export function getRecordStream() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (!recDest) {
    try { recDest = actx.createMediaStreamDestination(); bus().connect(recDest); } catch (e) { recDest = null; return null; }
  }
  return recDest.stream;
}

// Low surveillance-room tone — a quiet mains hum + electrical buzz so the silence
// itself reads "we are watching". Started once on the first audio init.
export function startAmbience() {
  if (!actx || ambient) return;
  try {
    const hum = actx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 52;
    const hg = actx.createGain(); hg.gain.value = 0.012; hum.connect(hg); hg.connect(bus()); hum.start();
    const buzz = actx.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.value = 60;
    const bf = actx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 190;
    const bg = actx.createGain(); bg.gain.value = 0.005; buzz.connect(bf); bf.connect(bg); bg.connect(bus()); buzz.start();
    ambient = { hum, buzz };
  } catch (e) {}
}

// One-shot filtered noise burst (camera clicks, the catch "thud").
function noiseBurst(dur = 0.2, vol = 0.2, freq = 1200, type = 'bandpass') {
  if (!actx) return;
  const n = Math.max(1, Math.floor(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = actx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(bus()); src.start();
}

export function beep(freq, dur, type = 'sine', vol = 0.06) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(bus());
  const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur);
}

// Named cues so gameplay code reads cleanly.
export const sfx = {
  glitch() { beep(170, 0.25, 'sawtooth', 0.08); },
  react()  { beep(680, 0.08, 'triangle', 0.05); },
  catch()  { beep(220, 0.12, 'sawtooth'); setTimeout(() => beep(140, 0.25, 'sawtooth'), 120); noiseBurst(0.42, 0.32, 170, 'lowpass'); },
  scan()   { beep(1400, 0.1, 'sine', 0.045); setTimeout(() => beep(880, 0.18, 'sine', 0.035), 70); },   // sonar: subject acquired
  shutter() { noiseBurst(0.05, 0.28, 3200, 'highpass'); setTimeout(() => noiseBurst(0.03, 0.16, 2200, 'highpass'), 45); },
  bot()    { beep(160, 0.1, 'square', 0.06); setTimeout(() => beep(110, 0.18, 'sawtooth', 0.05), 90); },
  decoy()  { beep(520, 0.12, 'triangle', 0.06); },
  clear()  { beep(523, 0.1, 'triangle'); setTimeout(() => beep(784, 0.16, 'triangle'), 110); },
  tickLow(n) { beep(440 + (10 - n) * 40, 0.05, 'square', 0.04); },
  heart(intensity) { beep(60, 0.12, 'sine', 0.05 * intensity); },
  taunt(i) { beep([523, 659, 784, 880][i % 4], 0.12, 'triangle', 0.05); },
  tell()   { beep(990, 0.05, 'triangle', 0.035); },   // faint "tell" blip when a body slips nearby
};
