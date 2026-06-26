// ============================================================
// HUMAN ERROR — shared tunables, maps, perks, glitches
// Single source of truth for both game modes. No DOM, no canvas.
// ============================================================

// World dimensions (canvas logical size; rendering may scale to fit).
export const W = 960, H = 600;
export const PAD = 40;
export const ARENA = { x: PAD, y: PAD + 30, w: W - PAD * 2, h: H - PAD * 2 - 30 };

export const BODY_R = 11;

// Body silhouettes — varied shapes so the crowd reads as a crowd, not clones.
// Pure cosmetic; collision still uses BODY_R. Renderer scales the drawn body.
// Assigned deterministically per-agent from the match RNG (see sim.buildCrowd).
export const BODY_SHAPES = [
  { id: 'reg',   bw: 10, bh: 12, hr: 5,   sx: 1.00 },  // regular
  { id: 'tall',  bw: 9,  bh: 14, hr: 4.6, sx: 0.95 },  // lanky
  { id: 'round', bw: 12, bh: 11, hr: 5.4, sx: 1.05 },  // stout
  { id: 'small', bw: 8,  bh: 10, hr: 4.4, sx: 0.9  },  // small
  { id: 'wide',  bw: 13, bh: 12, hr: 5.2, sx: 1.08 },  // broad
];

// Movement / behavior tunables.
export const TUNING = {
  npcSpeed: 58,
  danceDrift: 5,
  playerWalk: 140,
  playerSprint: 175,
  hunterRoam: 84,
  hunterChase: 120,
  hunterInspect: 96,
  catchR: 26,
  slipSprint: 140,
  slipFlinch: 150,
  slipBunch: 70,
};

// Wave roguelite pacing (solo).
export const WAVE = {
  secs: 40,
  npcCount: 33,
  botCount: 3,
  maxHunters: 4,
};

// Visual palette (also used by client renderer; kept here so sim + ui agree).
export const PALETTE = {
  bg: '#0b0f17',
  arena: '#0e1422',
  grid: '#172033',
  ink: '#e8edf5',
  muted: '#8b97a8',
  green: '#2bd479',
  pink: '#ff2e63',
  blue: '#38bdf8',
  amber: '#f5b942',
  skin: '#8a93a6',
  skinHead: '#9aa3b6',
  skinDark: '#5b6376',
};

// Crowd skins — pure cosmetic recolors for clip/meme variety.
export const SKINS = [
  { id: 'slate',  body: '#8a93a6', head: '#9aa3b6', dark: '#5b6376' },
  { id: 'sand',   body: '#b7a07e', head: '#c9b48f', dark: '#7d6a4e' },
  { id: 'moss',   body: '#7e9e7a', head: '#93b38d', dark: '#54704f' },
  { id: 'rose',   body: '#b08591', head: '#c89aa6', dark: '#75545d' },
  { id: 'steel',  body: '#7d8aa0', head: '#93a0b6', dark: '#525d70' },
  { id: 'amber',  body: '#bda05a', head: '#d4b86c', dark: '#7e6a3a' },
  { id: 'violet', body: '#9385b6', head: '#a99ccb', dark: '#5f567a' },
];
const SKIN_IDS = SKINS.map(s => s.id);
export function skinIndex(id) { const i = SKIN_IDS.indexOf(id); return i < 0 ? 0 : i; }

// Maps differ only in pillar/cover layout + skin. Geometry is map-driven so
// solo and multiplayer share the exact same collision/LOS code.
function P(fx, fy, fw, fh) {
  return {
    x: ARENA.x + ARENA.w * fx, y: ARENA.y + ARENA.h * fy,
    w: fw, h: fh,
  };
}

export const MAPS = [
  {
    id: 'plaza', name: 'Plaza', skin: 'slate',
    pillars: [
      P(0.24, 0.30, 46, 46), P(0.62, 0.24, 54, 40), P(0.40, 0.62, 60, 44),
      P(0.78, 0.66, 44, 56), P(0.12, 0.70, 40, 40),
    ],
  },
  {
    id: 'atrium', name: 'Atrium', skin: 'moss',
    pillars: [
      P(0.30, 0.20, 38, 38), P(0.66, 0.20, 38, 38),
      P(0.30, 0.70, 38, 38), P(0.66, 0.70, 38, 38),
      P(0.48, 0.46, 70, 70),
    ],
  },
  {
    id: 'stacks', name: 'Stacks', skin: 'steel',
    pillars: [
      P(0.20, 0.18, 26, 120), P(0.42, 0.40, 26, 120),
      P(0.64, 0.18, 26, 120), P(0.80, 0.46, 26, 120),
      P(0.30, 0.66, 110, 24),
    ],
  },
  {
    id: 'gallery', name: 'Gallery', skin: 'rose',
    pillars: [
      P(0.16, 0.16, 90, 22), P(0.62, 0.16, 90, 22),
      P(0.16, 0.78, 90, 22), P(0.62, 0.78, 90, 22),
      P(0.40, 0.42, 28, 64), P(0.56, 0.42, 28, 64),
    ],
  },
  {
    id: 'maze', name: 'Hedge Maze', skin: 'amber',
    pillars: [
      P(0.26, 0.12, 22, 90), P(0.50, 0.30, 22, 90), P(0.74, 0.12, 22, 90),
      P(0.14, 0.52, 90, 22), P(0.50, 0.60, 22, 90), P(0.60, 0.50, 80, 22),
      P(0.26, 0.74, 22, 70),
    ],
  },
  {
    id: 'rotunda', name: 'Rotunda', skin: 'violet',
    pillars: [
      P(0.30, 0.24, 34, 34), P(0.66, 0.24, 34, 34),
      P(0.20, 0.50, 34, 34), P(0.78, 0.50, 34, 34),
      P(0.30, 0.74, 34, 34), P(0.66, 0.74, 34, 34),
      P(0.48, 0.48, 40, 40),
    ],
  },
];

export function mapById(id) { return MAPS.find(m => m.id === id) || MAPS[0]; }

// Perks (solo roguelite). Effects are read by the solo rules layer.
export const ALL_PERKS = [
  { id: 'calm',    name: 'Nerves of Steel', desc: 'Suspicion builds 30% slower.' },
  { id: 'decay',   name: 'Cool Customer',   desc: 'Blend cooldown is 70% faster.' },
  { id: 'ghost',   name: 'Ghost Step',      desc: 'While slow-walking, scans barely read you.' },
  { id: 'decoy',   name: 'Decoy Drop',      desc: 'Press Q: drop a fake that pulls Hunters. (12s)' },
  { id: 'sprint',  name: 'Second Wind',     desc: 'Sprint faster — outrun the Hunter.' },
  { id: 'radar',   name: 'Sixth Sense',     desc: 'See a line to whoever each Hunter is locking.' },
  { id: 'mimic',   name: 'Perfect Mimic',   desc: 'Auto-match the nearest NPC pose for free.' },
  { id: 'still',   name: 'Dead Calm',       desc: 'Standing still drains suspicion much faster.' },
  // wave-2 expansion
  { id: 'adren',   name: 'Adrenaline',      desc: 'After a glitch ends, suspicion drains 2× for 4s.' },
  { id: 'slip',    name: 'Slippery',        desc: 'Brief grace each time a Hunter first spots you.' },
  { id: 'veteran', name: 'Veteran',         desc: 'Bank +60 score every wave you clear.' },
  { id: 'doppel',  name: 'Doppelgänger',    desc: 'Mimic blending also works while slow-walking.' },
  { id: 'lowpro',  name: 'Low Profile',     desc: 'In a tight crowd (3+) you read far less human.' },
  { id: 'magnet',  name: 'Magnet Decoy',    desc: 'Decoys last longer and yank Hunters harder.' },
  { id: 'blink',   name: 'Blink Step',      desc: 'Press Q: dash a short hop in your facing. (7s)' },
];

// Glitch events — forced crowd reactions; humans who fumble stand out.
export const GLITCHES = [
  { type: 'alarm',   name: '🚨 FIRE ALARM',    sub: 'SPACE — run for an exit!',      window: 1.5, t: 2.4 },
  { type: 'cash',    name: '💸 CASH DROPPED',   sub: 'SPACE — rush the center!',      window: 1.5, t: 2.2 },
  { type: 'freeze',  name: '🧊 SYSTEM FREEZE',  sub: 'SPACE — hold perfectly still!', window: 1.5, t: 1.9 },
  { type: 'wave',    name: '👋 CROWD WAVE',     sub: 'SPACE — join the wave!',        window: 1.4, t: 2.0 },
  { type: 'scatter', name: '🏃 STAMPEDE',       sub: 'SPACE — bolt to a wall!',       window: 1.4, t: 2.1 },
  { type: 'bow',     name: '🙇 TAKE A BOW',     sub: 'SPACE — face down and bow!',    window: 1.5, t: 1.8 },
  { type: 'spin',    name: '🌀 DIZZY SPELL',    sub: 'SPACE — spin in place!',        window: 1.4, t: 2.0 },
];

export const POSE = { IDLE: 'idle', WALK: 'walk', DANCE: 'dance' };
export const KIND = { NPC: 'npc', BOT: 'bot', HUMAN: 'human', HUNTER: 'hunter' };
