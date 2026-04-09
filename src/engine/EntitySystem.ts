import { Entity, EntitySpec } from '../types';
import { EventBus } from './EventBus';
import { overlapsRect, dist, randomFloat } from '../utils/math';

// Minimal interface for the player — avoids circular dependency with PlayerController
export interface PlayerLike {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  onGround: boolean;
}

// Minimal interface for the tilemap — avoids importing the full Tilemap class
export interface TilemapLike {
  tileSize: number;
  worldPixelWidth: number;
  getTileAt(col: number, row: number): number;
  getTilesInRect(px: number, py: number, pw: number, ph: number): any[];
}

const DEFAULT_TILE_SIZE = 16;

let _entityIdCounter = 0;
function nextId(): string {
  return `entity_${++_entityIdCounter}`;
}

function makeEntity(partial: Partial<Entity> & { type: Entity['type']; archetype: string; x: number; y: number }): Entity {
  return {
    id: nextId(),
    vx: 0,
    vy: 0,
    width: 8,
    height: 8,
    health: 1,
    direction: 1,
    speed: 0,
    active: true,
    onGround: false,
    aggroRange: 0,
    baseY: partial.y,
    freq: 0,
    amp: 0,
    animFrame: 0,
    animTimer: 0,
    params: {},
    ...partial,
  };
}

export class EntitySystem {
  public entities: Entity[] = [];

  private events: EventBus;

  constructor(events: EventBus) {
    this.events = events;
  }

  // ─── Initialise from level spec ───────────────────────────────────────────────

  init(specs: EntitySpec[]): void {
    this.entities = [];

    for (const spec of specs) {
      const tileSize = DEFAULT_TILE_SIZE;
      const px = spec.x * tileSize;
      const py = spec.y * tileSize;

      let entity: Entity;

      switch (spec.archetype) {
        case 'patrol':
          entity = makeEntity({
            id: spec.id,
            type: spec.type,
            archetype: spec.archetype,
            x: px,
            y: py,
            width: 12,
            height: 8,
            speed: 1.5,
            health: 2,
            direction: 1,
            params: spec.params,
          });
          break;

        case 'flyer':
          entity = makeEntity({
            id: spec.id,
            type: spec.type,
            archetype: spec.archetype,
            x: px,
            y: py,
            baseY: py,
            width: 10,
            height: 7,
            speed: 1.2,
            health: 1,
            amp: (spec.params.amp as number) ?? 20,
            freq: (spec.params.freq as number) ?? 0.03,
            params: spec.params,
          });
          break;

        case 'chaser':
          entity = makeEntity({
            id: spec.id,
            type: spec.type,
            archetype: spec.archetype,
            x: px,
            y: py,
            width: 8,
            height: 8,
            speed: 0,
            health: 2,
            aggroRange: (spec.params.aggroRange as number) ?? 120,
            params: spec.params,
          });
          break;

        case 'collectible':
        case 'coin':
          entity = makeEntity({
            id: spec.id,
            type: spec.type,
            archetype: spec.archetype,
            x: px,
            y: py,
            width: 6,
            height: 6,
            health: 1,
            params: spec.params,
          });
          break;

        case 'checkpoint':
          entity = makeEntity({
            id: spec.id,
            type: 'checkpoint',
            archetype: 'checkpoint',
            x: px,
            y: py,
            width: 8,
            height: 16,
            health: 999,
            params: spec.params,
          });
          break;

        default:
          // Generic fallback — honour any width/height from params
          entity = makeEntity({
            id: spec.id,
            type: spec.type,
            archetype: spec.archetype,
            x: px,
            y: py,
            width: (spec.params.width as number) ?? 8,
            height: (spec.params.height as number) ?? 8,
            health: (spec.params.health as number) ?? 1,
            params: spec.params,
          });
          break;
      }

      this.entities.push(entity);
    }
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────────

  update(player: PlayerLike, tilemap: TilemapLike, events: EventBus, dt: number): void {
    for (const entity of this.entities) {
      if (!entity.active) continue;

      switch (entity.archetype) {
        case 'patrol':
          this._updatePatrol(entity, tilemap);
          break;

        case 'flyer':
          this._updateFlyer(entity, tilemap);
          break;

        case 'chaser':
          this._updateChaser(entity, player, tilemap);
          break;
      }

      // ── Collision checks ───────────────────────────────────────────────────────

      if (entity.type === 'enemy' && entity.active) {
        this._checkPlayerEnemyCollision(player, entity, events);
      }

      if ((entity.archetype === 'collectible' || entity.archetype === 'coin') && entity.active) {
        if (overlapsRect(player.x, player.y, player.width, player.height,
                         entity.x, entity.y, entity.width, entity.height)) {
          entity.active = false;
          events.emit('collectible_picked_up', { entity });
        }
      }

      if (entity.archetype === 'key' && entity.active) {
        if (overlapsRect(player.x, player.y, player.width, player.height,
                         entity.x, entity.y, entity.width, entity.height)) {
          entity.active = false;
          events.emit('collectible_picked_up', { entity });
        }
      }

      if (entity.type === 'checkpoint' && entity.active) {
        if (!entity.params._activated &&
            overlapsRect(player.x, player.y, player.width, player.height,
                         entity.x, entity.y, entity.width, entity.height)) {
          entity.params._activated = true;
          events.emit('checkpoint_reached', { entity });
        }
      }
    }

    // Remove inactive entities at end of frame
    this.entities = this.entities.filter(e => e.active);
  }

  // ─── Patrol movement ──────────────────────────────────────────────────────────

  private _updatePatrol(entity: Entity, tilemap: TilemapLike): void {
    entity.x += entity.direction * entity.speed;

    const ahead = entity.direction > 0
      ? entity.x + entity.width + 2
      : entity.x - 2;

    const tileAhead = tilemap.getTileAt(
      Math.floor(ahead / tilemap.tileSize),
      Math.floor((entity.y + entity.height) / tilemap.tileSize),
    );
    const tileBelow = tilemap.getTileAt(
      Math.floor((entity.x + entity.width / 2) / tilemap.tileSize),
      Math.floor((entity.y + entity.height + 2) / tilemap.tileSize),
    );

    // Turn at solid wall or edge of platform
    if (tileAhead === 1 || tileBelow === 0) {
      entity.direction = (entity.direction === 1 ? -1 : 1) as 1 | -1;
    }
  }

  // ─── Flyer movement ───────────────────────────────────────────────────────────

  private _updateFlyer(entity: Entity, tilemap: TilemapLike): void {
    entity.x += entity.speed;
    entity.y = entity.baseY + Math.sin(performance.now() * 0.001 * entity.freq * 60) * entity.amp;

    if (entity.x > tilemap.worldPixelWidth - entity.width || entity.x < 0) {
      entity.speed *= -1;
    }
  }

  // ─── Chaser movement ──────────────────────────────────────────────────────────

  private _updateChaser(entity: Entity, player: PlayerLike, tilemap: TilemapLike): void {
    const d = dist(entity.x, entity.y, player.x, player.y);

    if (d < entity.aggroRange) {
      const baseSpeed = (entity.params.speed as number) || 1.5;
      const speed = Math.min(baseSpeed, 1.5 + (1 - d / entity.aggroRange) * 2);

      entity.vx = Math.sign(player.x - entity.x) * speed;
      entity.vy += 0.5; // gravity
      entity.vy = Math.min(entity.vy, 8);

      entity.x += entity.vx;
      entity.y += entity.vy;

      // Simple ground check — stop falling when standing on solid tile
      const groundTile = tilemap.getTileAt(
        Math.floor((entity.x + entity.width / 2) / tilemap.tileSize),
        Math.floor((entity.y + entity.height + 2) / tilemap.tileSize),
      );
      if (groundTile === 1 && entity.vy > 0) {
        entity.y = Math.floor((entity.y + entity.height) / tilemap.tileSize) * tilemap.tileSize - entity.height;
        entity.vy = 0;
      }
    }
  }

  // ─── Player / enemy collision ─────────────────────────────────────────────────

  private _checkPlayerEnemyCollision(player: PlayerLike, enemy: Entity, events: EventBus): void {
    if (!overlapsRect(player.x, player.y, player.width, player.height,
                      enemy.x, enemy.y, enemy.width, enemy.height)) {
      return;
    }

    // STOMP: player falling AND player bottom (before this frame) was above enemy centre
    const playerBottomPrev = player.y + player.height - player.vy;
    const enemyCentre = enemy.y + enemy.height / 2;

    if (player.vy > 0 && playerBottomPrev < enemyCentre) {
      enemy.active = false;
      events.emit('enemy_killed', { entity: enemy });
      // Signal the player system to apply a bounce — index.ts / VoiceMomentSystem
      // reads this event and calls player.vy = -10
      events.emit('player_stomp_bounce', {});
    } else {
      // Side collision — damage player
      events.emit('player_damaged_by_enemy', { entity: enemy });
    }
  }

  // ─── Imperative spawn helpers (used by VoiceMomentSystem) ────────────────────

  spawnEnemy(spec: EntitySpec): void {
    const tileSize = DEFAULT_TILE_SIZE;
    const px = spec.x * tileSize;
    const py = spec.y * tileSize;

    let entity: Entity;

    switch (spec.archetype) {
      case 'flyer':
        entity = makeEntity({
          id: spec.id,
          type: spec.type,
          archetype: spec.archetype,
          x: px,
          y: py,
          baseY: py,
          width: 10,
          height: 7,
          speed: 1.2,
          health: 1,
          amp: (spec.params.amp as number) ?? 20,
          freq: (spec.params.freq as number) ?? 0.03,
          params: spec.params,
        });
        break;

      case 'chaser':
        entity = makeEntity({
          id: spec.id,
          type: spec.type,
          archetype: spec.archetype,
          x: px,
          y: py,
          width: 8,
          height: 8,
          speed: 0,
          health: 2,
          aggroRange: (spec.params.aggroRange as number) ?? 120,
          params: spec.params,
        });
        break;

      case 'patrol':
      default:
        entity = makeEntity({
          id: spec.id,
          type: spec.type,
          archetype: 'patrol',
          x: px,
          y: py,
          width: 12,
          height: 8,
          speed: 1.5,
          health: 2,
          direction: 1,
          params: spec.params,
        });
        break;
    }

    this.entities.push(entity);
  }

  spawnMaskEnemies(count: number, nearX: number, tilemap: TilemapLike): void {
    const tileSize = tilemap.tileSize;
    // Spread enemies across a ~200px window centred on nearX
    const spread = 200;
    const startX = Math.max(0, nearX - spread / 2);

    for (let i = 0; i < count; i++) {
      const px = startX + randomFloat(0, spread);
      // Place at a y that puts the enemy roughly 3 tiles above the world bottom
      const py = Math.max(0, tilemap.worldPixelWidth * 0); // start near top; tilemap handles clamping
      const placedY = 3 * tileSize; // safe default — entity will fall to ground

      const entity = makeEntity({
        id: nextId(),
        type: 'enemy',
        archetype: 'patrol',
        x: px,
        y: placedY,
        width: 12,
        height: 8,
        speed: 1.5,
        health: 2,
        direction: (Math.random() > 0.5 ? 1 : -1) as 1 | -1,
        params: {},
      });

      this.entities.push(entity);
    }
  }

  spawnKey(nearX: number, tilemap: TilemapLike): Entity {
    // Place the key on the far side of the room from nearX
    const margin = 40;
    const farX = nearX < tilemap.worldPixelWidth / 2
      ? tilemap.worldPixelWidth - margin
      : margin;

    const entity = makeEntity({
      id: nextId(),
      type: 'collectible',
      archetype: 'key',
      x: farX,
      y: 3 * tilemap.tileSize, // near top; will sit in open air or on a platform
      width: 8,
      height: 10,
      health: 1,
      params: {
        isKey: true,
        color: '#ffee44',
        glowColor: '#ffffff',
      },
    });

    this.entities.push(entity);
    return entity;
  }
}
