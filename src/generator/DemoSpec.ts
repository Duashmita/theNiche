import { GameSpec } from '../types';

// ─── Tile type constants (mirrors TileType in types.ts) ───────────────────────
// Kept local so this file has zero runtime dependencies.
const AIR      = 0;
const GROUND   = 1;
const PLATFORM = 2;
const HAZARD   = 3;
const DOOR     = 4;
const TRIGGER  = 5;

// ─── Map dimensions ───────────────────────────────────────────────────────────
const W = 120;   // columns
const H = 30;    // rows
const GROUND_ROW = 23;

// ─── buildDemoTiles ───────────────────────────────────────────────────────────
//
// Hand-crafted 120 × 30 tile grid.
// Rule: no gap wider than 4 tiles, every gap has a bridging platform.
//
function buildDemoTiles(): number[][] {
  // Allocate: H rows of W columns, all AIR
  const t: number[][] = Array.from({ length: H }, () => new Array(W).fill(AIR));

  // ── Solid ground (rows 23 – 29) ──────────────────────────────────────────
  for (let row = GROUND_ROW; row < H; row++) {
    for (let col = 0; col < W; col++) {
      t[row][col] = GROUND;
    }
  }

  // ── Border walls ─────────────────────────────────────────────────────────
  for (let row = 0; row < H; row++) {
    t[row][0]     = GROUND;
    t[row][1]     = GROUND;
    t[row][W - 1] = GROUND;
    t[row][W - 2] = GROUND;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — Intro (cols 2 – 29)
  //   Mostly flat.  One 2-tile gap at cols 14-15 to introduce jumping.
  // ═══════════════════════════════════════════════════════════════════════════

  // Gap: cols 14-15  (2 tiles — trivially jumpable without abilities)
  for (let row = GROUND_ROW; row < H; row++) {
    t[row][14] = AIR;
    t[row][15] = AIR;
  }
  // Bridging platform (row 20, cols 13-17)
  for (let col = 13; col <= 17; col++) {
    t[20][col] = PLATFORM;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — First challenge (cols 30 – 59)
  //   Two gaps with hazard floors; elevated platforms to cross them.
  // ═══════════════════════════════════════════════════════════════════════════

  // Gap A: cols 33-36  (4 tiles — needs a precise jump or the platform)
  for (let row = GROUND_ROW; row < H; row++) {
    for (let col = 33; col <= 36; col++) {
      t[row][col] = AIR;
    }
  }
  // Hazard floor
  for (let col = 33; col <= 36; col++) {
    t[GROUND_ROW][col] = HAZARD;
  }
  // Elevated platform (row 19, cols 32-38) — requires a normal jump to reach
  for (let col = 32; col <= 38; col++) {
    t[19][col] = PLATFORM;
  }

  // Gap B: cols 46-49  (4 tiles — simple pit, no hazard)
  for (let row = GROUND_ROW; row < H; row++) {
    for (let col = 46; col <= 49; col++) {
      t[row][col] = AIR;
    }
  }
  // Low platform (row 20, cols 45-51) — easy jump across
  for (let col = 45; col <= 51; col++) {
    t[20][col] = PLATFORM;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — Recovery / checkpoint (cols 60 – 74)
  //   Flat ground.  No obstacles — breathing room before the hard section.
  //   Checkpoint and coins placed via entity array.
  // ═══════════════════════════════════════════════════════════════════════════
  // (No tile mutations needed)

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — Hard challenge (cols 75 – 100)
  //   Two gaps with hazard floors; stepping-stone and double-jump paths.
  // ═══════════════════════════════════════════════════════════════════════════

  // Gap C: cols 77-80  (4 tiles)
  for (let row = GROUND_ROW; row < H; row++) {
    for (let col = 77; col <= 80; col++) {
      t[row][col] = AIR;
    }
  }
  for (let col = 77; col <= 80; col++) {
    t[GROUND_ROW][col] = HAZARD;
  }
  // Stepping stones at row 18 (high — needs double_jump or a careful hop)
  t[18][79] = PLATFORM;
  t[18][80] = PLATFORM;
  t[18][81] = PLATFORM;
  // Lower continuation after the gap
  t[20][82] = PLATFORM;
  t[20][83] = PLATFORM;
  t[20][84] = PLATFORM;

  // Gap D: cols 87-90  (4 tiles — max legal gap)
  for (let row = GROUND_ROW; row < H; row++) {
    for (let col = 87; col <= 90; col++) {
      t[row][col] = AIR;
    }
  }
  for (let col = 87; col <= 90; col++) {
    t[GROUND_ROW][col] = HAZARD;
  }
  // Mid-air bridge (row 19, cols 88-90)
  t[19][88] = PLATFORM;
  t[19][89] = PLATFORM;
  t[19][90] = PLATFORM;
  // High platform for double_jump reward (row 17, cols 91-92)
  t[17][91] = PLATFORM;
  t[17][92] = PLATFORM;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — Voice-moment zone (cols 101 – 119)
  //   Trigger tile → key_fetch mask → DOOR reveals what the player said.
  // ═══════════════════════════════════════════════════════════════════════════

  // Trigger tile (surface level so player walks over it)
  t[22][103] = TRIGGER;

  // Platform run before the door (row 21, cols 104-108) — slows the player
  for (let col = 104; col <= 108; col++) {
    t[21][col] = PLATFORM;
  }

  // DOOR (3 tiles tall, 2 tiles wide) at cols 109-110, rows 20-22
  for (let row = 20; row <= 22; row++) {
    t[row][109] = DOOR;
    t[row][110] = DOOR;
  }

  return t;
}

// ─── DEMO_SPEC ────────────────────────────────────────────────────────────────

export const DEMO_SPEC: GameSpec = {
  meta: {
    name: 'The Dark Forest',
    description: 'A forest platformer with a mysterious door',
    difficulty: 0.35,
  },
  display: {
    nativeWidth: 320,
    nativeHeight: 180,
    tileSize: 16,
    renderScale: 3,
  },
  map: {
    width: W,
    height: H,
    layout: 'linear',
    tiles: buildDemoTiles(),
    spawnPoint: { x: 3, y: 21 },
    exitPoint:  { x: 116, y: 21 },
  },
  theme: {
    tileset: 'forest',
    palette: ['#4a8a2c', '#2d5a1b', '#8acc44', '#ffcc44'],
    backgroundColor: '#0d1b0d',
    music: 'forest_ambient',
    sfxSet: 'forest',
    parallaxLayers: [],
  },
  player: {
    sprite: 'player',
    abilities: ['double_jump'],
    health: 3,
  },
  entities: [
    // ── Intro: coin trail ────────────────────────────────────────────────────
    { id: 'coin_1', type: 'collectible', archetype: 'coin', x:  6, y: 21, params: {} },
    { id: 'coin_2', type: 'collectible', archetype: 'coin', x:  8, y: 21, params: {} },
    { id: 'coin_3', type: 'collectible', archetype: 'coin', x: 10, y: 21, params: {} },

    // ── Section 2: first gap guard ───────────────────────────────────────────
    { id: 'enemy_1', type: 'enemy', archetype: 'patrol',
      x: 25, y: 22, params: { speed: 1.2 } },

    // Coin on the elevated platform over gap A
    { id: 'coin_4', type: 'collectible', archetype: 'coin', x: 35, y: 18, params: {} },

    // Chaser in the back half of section 2
    { id: 'enemy_2', type: 'enemy', archetype: 'chaser',
      x: 52, y: 22, params: { speed: 1.8, aggroRange: 120 } },

    // ── Section 3: checkpoint ────────────────────────────────────────────────
    { id: 'checkpoint_1', type: 'checkpoint', archetype: 'checkpoint',
      x: 67, y: 22, params: {} },

    // Coin arc around the checkpoint
    { id: 'coin_5', type: 'collectible', archetype: 'coin', x: 63, y: 20, params: {} },
    { id: 'coin_6', type: 'collectible', archetype: 'coin', x: 65, y: 20, params: {} },
    { id: 'coin_7', type: 'collectible', archetype: 'coin', x: 69, y: 20, params: {} },

    // ── Section 4: hard enemies ──────────────────────────────────────────────
    { id: 'enemy_3', type: 'enemy', archetype: 'patrol',
      x: 83, y: 22, params: { speed: 1.5 } },
    { id: 'enemy_4', type: 'enemy', archetype: 'patrol',
      x: 95, y: 22, params: { speed: 1.6 } },

    // Coin on the high double-jump platform (row 17)
    { id: 'coin_8', type: 'collectible', archetype: 'coin', x: 91, y: 16, params: {} },
  ],
  rules: [],
  voiceMoments: [
    {
      id: 'vm_door',
      triggerTile: { x: 103, y: 22 },
      prompt: 'What waits behind the door?',
      mapsTo: ['room_contents', 'enemy_types', 'hazard'],
      mask: {
        type: 'key_fetch',
        minDurationMs: 4000,
        extend: 'spawn_enemy',
      },
      reveal: 'door_open',
      fallbackOptions: [
        'A wave of enemies',
        'Platforms over a lava pit',
        'A powerful weapon',
        'A calm safe passage',
      ],
    },
  ],
};
