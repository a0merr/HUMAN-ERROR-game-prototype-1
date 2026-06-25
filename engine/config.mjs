// ============================================================
// HUMAN ERROR — shared tunables, maps, perks, glitches
// Single source of truth for both game modes. No DOM, no canvas.
// ============================================================

// World dimensions (canvas logical size; rendering may scale to fit).
export const W = 960, H = 600;
export const PAD = 40;
export const ARENA = { x: PAD, y: PAD + 30, w: W - PAD * 2, h: H - PAD * 2 - 30 };

export const BODY_R = 11;

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
];

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
];

export function mapById(id) { return MAPS.find(m => m.id === id) || MAPS[0]; }

// Perks (solo roguelite). Effects are read by the solo rules layer.
export const ALL_PERKS = [
  { id: 'calm',   name: 'Nerves of Steel', desc: 'Suspicion builds 30% slower.' },
  { id: 'decay',  name: 'Cool Customer',   desc: 'Blend cooldown is 70% faster.' },
  { id: 'ghost',  name: 'Ghost Step',      desc: 'While slow-walking, scans barely read you.' },
  { id: 'decoy',  name: 'Decoy Drop',      desc: 'Press Q: drop a fake that pulls Hunters. (12s)' },
  { id: 'sprint', name: 'Second Wind',     desc: 'Sprint faster — outrun the Hunter.' },
  { id: 'radar',  name: 'Sixth Sense',     desc: 'See a line to whoever each Hunter is locking.' },
  { id: 'mimic',  name: 'Perfect Mimic',   desc: 'Auto-match the nearest NPC pose for free.' },
  { id: 'still',  name: 'Dead Calm',       desc: 'Standing still drains suspicion much faster.' },
];

// Glitch events — forced crowd reactions; humans who fumble stand out.
export const GLITCHES = [
  { type: 'alarm',  name: '🚨 FIRE ALARM',   sub: 'SPACE — run for an exit!',      window: 1.5, t: 2.4 },
  { type: 'cash',   name: '💸 CASH DROPPED',  sub: 'SPACE — rush the center!',      window: 1.5, t: 2.2 },
  { type: 'freeze', name: '🧊 SYSTEM FREEZE', sub: 'SPACE — hold perfectly still!', window: 1.5, t: 1.9 },
  { type: 'wave',   name: '👋 CROWD WAVE',    sub: 'SPACE — join the wave!',        window: 1.4, t: 2.0 },
];

export const POSE = { IDLE: 'idle', WALK: 'walk', DANCE: 'dance' };
export const KIND = { NPC: 'npc', BOT: 'bot', HUMAN: 'human', HUNTER: 'hunter' };
