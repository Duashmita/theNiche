// ─── Tile constants ────────────────────────────────────────────────────────────
export const TileType = {
  AIR: 0,
  GROUND: 1,
  PLATFORM: 2,   // one-way, solid from above only
  HAZARD: 3,     // kills on contact
  DOOR: 4,       // solid until voice-moment unlocks
  TRIGGER: 5,    // invisible, fires event on overlap
  DECORATION: 6, // visual only
  LADDER: 7,
} as const;

export const CollisionType = {
  NONE: 'none',
  SOLID: 'solid',
  PLATFORM: 'platform',
  HAZARD: 'hazard',
  TRIGGER: 'trigger',
} as const;
export type CollisionType = (typeof CollisionType)[keyof typeof CollisionType];

// ─── ID union types ────────────────────────────────────────────────────────────
export type ThemeId =
  | 'forest' | 'underwater' | 'space' | 'city' | 'dungeon' | 'ice';

export type AbilityId =
  | 'double_jump' | 'wall_slide' | 'dash' | 'wall_jump'
  | 'ground_pound' | 'glide' | 'swim' | 'shoot' | 'grapple' | 'size_change';

export type RuleId =
  | 'gravity_flip' | 'floor_decay' | 'size_change' | 'speed_boost'
  | 'vision_limit' | 'time_limit' | 'wind' | 'darkness' | 'enemy_grow' | 'mirror';

export type EnemyArchetype = 'patrol' | 'flyer' | 'chaser' | 'turret' | 'boss';

export type MaskType =
  | 'key_fetch' | 'enemy_wave' | 'traversal' | 'craft_animation' | 'npc_dialogue';

export type RevealAnimation =
  | 'door_open' | 'fog_lift' | 'item_receive' | 'boss_entrance' | 'environment_shift';

export type LayoutType = 'linear' | 'rooms' | 'arena';

// ─── GameSpec interfaces (the DSL) ────────────────────────────────────────────
export interface MapSpec {
  width: number;          // tile count
  height: number;
  layout: LayoutType;
  tiles: number[][];      // [row][col]
  spawnPoint: { x: number; y: number };  // tile coords
  exitPoint: { x: number; y: number };
}

export interface ThemeSpec {
  tileset: ThemeId;
  palette: string[];           // hex colors
  backgroundColor: string;
  music: string;
  sfxSet: string;
  parallaxLayers: string[];
}

export interface PlayerSpec {
  sprite: string;
  abilities: AbilityId[];
  health: number;
}

export interface EntitySpec {
  id: string;
  type: 'enemy' | 'collectible' | 'npc' | 'prop' | 'checkpoint';
  archetype: string;
  x: number;   // tile coords
  y: number;
  params: Record<string, unknown>;
}

export interface RuleSpec {
  id: RuleId;
  trigger?: string;
  params: Record<string, unknown>;
}

export interface MaskSpec {
  type: MaskType;
  minDurationMs: number;
  extend: string;
}

export interface VoiceMomentSpec {
  id: string;
  triggerTile: { x: number; y: number };  // tile coords
  prompt: string;
  mapsTo: string[];
  mask: MaskSpec;
  reveal: RevealAnimation;
  fallbackOptions?: string[];
}

export interface GameSpec {
  meta: {
    name: string;
    description: string;
    difficulty: number;   // 0.0 – 1.0
  };
  display: {
    nativeWidth: number;    // e.g. 320
    nativeHeight: number;   // e.g. 180
    tileSize: number;       // 16
    renderScale: number;    // 3 → display at 960×540
  };
  map: MapSpec;
  theme: ThemeSpec;
  player: PlayerSpec;
  entities: EntitySpec[];
  rules: RuleSpec[];
  voiceMoments: VoiceMomentSpec[];
}

// ─── LLM generation params (hybrid: LLM → params → procedural tiles) ─────────
export type SectionType = 'intro' | 'challenge' | 'checkpoint' | 'finale';

export interface MapSection {
  type: SectionType;
  widthTiles: number;
  hazardDensity: number;          // 0–1
  enemyCount: number;
  enemyArchetypes: EnemyArchetype[];
  hasCheckpoint: boolean;
}

export interface GenerationParams {
  title: string;
  description: string;
  layout: LayoutType;
  theme: ThemeId;
  difficulty: number;
  sections: MapSection[];
  abilities: AbilityId[];
  rules: RuleId[];
  voiceMomentCount: number;
  backgroundColor: string;
  palette: string[];
}

// ─── Runtime tile info (returned by Tilemap.getTilesInRect) ───────────────────
export interface TileInfo {
  col: number;
  row: number;
  pixelX: number;
  pixelY: number;
  collisionType: CollisionType;
  tileType: number;
}

// ─── Player ───────────────────────────────────────────────────────────────────
export type PlayerState =
  | 'idle' | 'running' | 'jumping' | 'falling'
  | 'landing' | 'wall_sliding' | 'dashing' | 'dead';

// ─── Entities ─────────────────────────────────────────────────────────────────
export interface Entity {
  id: string;
  type: 'enemy' | 'collectible' | 'npc' | 'prop' | 'checkpoint';
  archetype: string;
  x: number;          // pixel coords
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  health: number;
  direction: 1 | -1;
  speed: number;
  active: boolean;
  onGround: boolean;
  aggroRange: number;
  baseY: number;
  freq: number;
  amp: number;
  animFrame: number;
  animTimer: number;
  params: Record<string, unknown>;
}

// ─── Juice ────────────────────────────────────────────────────────────────────
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;     // ms remaining
  maxLife: number;
  color: string;
  size: number;
}

// ─── Voice moment ─────────────────────────────────────────────────────────────
export enum VoiceMomentPhase {
  IDLE       = 'IDLE',
  LISTENING  = 'LISTENING',
  PROCESSING = 'PROCESSING',
  READY      = 'READY',
  REVEALING  = 'REVEALING',
}

export interface StateChange {
  action:
    | 'fill_room' | 'spawn_enemies' | 'add_platforms'
    | 'give_weapon' | 'modify_terrain' | 'change_music' | 'spawn_boss';
  [key: string]: unknown;
}

export interface VoiceMomentResponse {
  voiceMomentId: string;
  interpretation: string;
  stateChanges: StateChange[];
}

// ─── Shared mutable game state (passed by reference everywhere) ───────────────
export type GamePhase =
  | 'loading' | 'creation' | 'gameplay' | 'voice_moment' | 'game_over';

export interface SharedState {
  spec: GameSpec | null;
  phase: GamePhase;
  gravity: number;       // can be flipped by GravityFlipRule
  score: number;
  health: number;
  maxHealth: number;
  frameCount: number;
  triggeredTiles: Set<string>;   // 'col,row' keys of already-fired triggers
  activeWeapon: string | null;
  gameOver: boolean;
}

// ─── Asset generation ─────────────────────────────────────────────────────────
export type AssetType =
  | 'ground' | 'platform' | 'hazard' | 'decoration'
  | 'player' | 'enemy_patrol' | 'enemy_flyer' | 'coin';

/** key: '{themeId}/{assetType}' → generated HTMLImageElement */
export type AssetMap = Map<string, HTMLImageElement>;

// ─── Theme colour palettes (used by Renderer, no image assets needed) ─────────
export const THEME_PALETTES: Record<ThemeId, {
  bg: string;
  ground: string;
  groundTop: string;
  platform: string;
  hazard: string;
  player: string;
  enemy: string;
  coin: string;
  trigger: string;
  door: string;
}> = {
  forest: {
    bg: '#0d1b0d', ground: '#2d5a1b', groundTop: '#4a8a2c',
    platform: '#3a6a22', hazard: '#cc4400',
    player: '#66ccff', enemy: '#cc4422', coin: '#ffcc44',
    trigger: '#44ffcc', door: '#8855aa',
  },
  dungeon: {
    bg: '#0d0d14', ground: '#3a3a5c', groundTop: '#5a5a7c',
    platform: '#4a4a6a', hazard: '#cc0033',
    player: '#aaddff', enemy: '#cc2244', coin: '#ffdd66',
    trigger: '#55ffaa', door: '#7744aa',
  },
  space: {
    bg: '#03030a', ground: '#1a2a3a', groundTop: '#2a4a6a',
    platform: '#1a3a5a', hazard: '#cc6600',
    player: '#88eeff', enemy: '#ff6622', coin: '#ffee55',
    trigger: '#44eeff', door: '#6655cc',
  },
  underwater: {
    bg: '#041020', ground: '#0a3a5a', groundTop: '#1a6a8a',
    platform: '#0a4a6a', hazard: '#cc3300',
    player: '#aaffee', enemy: '#ff4422', coin: '#ffdd44',
    trigger: '#44ffee', door: '#5544bb',
  },
  city: {
    bg: '#0a0a14', ground: '#2a2a3a', groundTop: '#4a4a5a',
    platform: '#3a3a4a', hazard: '#cc0000',
    player: '#ccddff', enemy: '#ff3344', coin: '#ffcc33',
    trigger: '#33ffcc', door: '#6644aa',
  },
  ice: {
    bg: '#080f1a', ground: '#3a6a8a', groundTop: '#6aaabf',
    platform: '#4a8aaa', hazard: '#aa00cc',
    player: '#eef8ff', enemy: '#cc44ff', coin: '#ffe066',
    trigger: '#44ffdd', door: '#8844dd',
  },
};
