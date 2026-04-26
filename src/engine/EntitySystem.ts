import { Entity, EntitySpec, SpawnParams } from '../types';
import { EventBus } from './EventBus';
import { InputSystem } from './InputSystem';
import { PlayerController } from './PlayerController';
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
  facing: 'left' | 'right';
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
            speed: Math.min(1.1, (spec.params.speed as number) ?? 1.0),
            health: 1,
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
            speed: 0.95,
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
            health: 1,
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

  update(player: PlayerController, tilemap: TilemapLike, events: EventBus, dt: number, input: InputSystem): void {
    this.handlePlayerCombat(player, input, tilemap, events);

    for (const entity of this.entities) {
      if (!entity.active) continue;

      // ── Bulletproof Coin Collection ──
      if (entity.type === 'collectible' && entity.active) {
        const hit = player.x < entity.x + entity.width &&
                    player.x + player.width > entity.x &&
                    player.y < entity.y + entity.height &&
                    player.y + player.height > entity.y;
        
        if (hit) {
          entity.active = false;
          events.emit('collectible_picked_up', { entity });
          events.emit('play_sound', { id: 'coin' }); // Wakes up audio engine instantly
          continue; // Skip the rest of the loop for this coin
        }
      }

      switch (entity.archetype) {
        case 'patrol':
          this._updatePatrol(entity, player, tilemap, events, dt);
          break;

        case 'chaser':
          this._updateChaser(entity, player, tilemap, events, dt);
          break;
        
        case 'boss':
          this._updateBoss(entity, player, tilemap, events, dt);
          break;

        case 'turret':
          this._updateTurret(entity, player, tilemap, events, dt);
          break;

        case 'projectile':
          this._updateProjectile(entity, player, tilemap, dt, events);
          break;

        case 'flyer':
          this._updateFlyerUpgraded(entity, player, tilemap, dt);
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

      if (entity.archetype === 'health_orb' && entity.active) {
        if (overlapsRect(player.x, player.y, player.width, player.height,
                         entity.x, entity.y, entity.width, entity.height)) {
          entity.active = false;
          events.emit('health_orb_picked_up', { entity });
        }
      }
    }

    // Remove inactive entities at end of frame
    this.entities = this.entities.filter(e => e.active);
  }

  // ─── Player shoot / melee ───────────────────────────────────────────────────

  private handlePlayerCombat(
    player: PlayerController,
    input: InputSystem,
    tilemap: TilemapLike,
    events: EventBus,
  ): void {
    if (input.shootBuffered && player.hasAbility('shoot') && player.shootCooldown <= 0) {
      player.shootCooldown = 320;
      input.consumeShoot();
      const ts = tilemap.tileSize;
      const cx = player.x + player.width / 2 + (player.facing === 'right' ? 8 : -8);
      const cy = player.y + player.height / 2;
      this.spawnEnemy({
        id:        `pproj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type:      'enemy',
        archetype: 'projectile',
        x:         Math.floor(cx / ts),
        y:         Math.floor(cy / ts),
        params:    {
          vx: 6.5 * (player.facing === 'right' ? 1 : -1),
          vy: 0,
          lifetime: 1800,
          fromPlayer: true,
        },
      });
      events.emit('play_sound', { id: 'coin' });
    }

    if (input.meleeBuffered && player.hasAbility('melee') && player.meleeTimer <= 0) {
      player.meleeTimer = 400;
      input.consumeMelee();
      this.applyMeleeSwing(player, events);
    }
  }

  private applyMeleeSwing(player: PlayerLike, events: EventBus): void {
    const reach = 18;
    const hx = player.facing === 'right' ? player.x + player.width : player.x - reach;
    const hy = player.y + 2;
    const mw = reach;
    const mh = Math.max(4, player.height - 4);

    for (const entity of this.entities) {
      if (!entity.active || entity.type !== 'enemy') continue;
      if (entity.archetype === 'projectile') continue;
      if (!overlapsRect(hx, hy, mw, mh, entity.x, entity.y, entity.width, entity.height)) continue;

      entity.health -= 1;
      events.emit('play_sound', { id: 'coin' });
      if (entity.health <= 0) {
        entity.active = false;
        events.emit('enemy_killed', { entity });
      }
    }
  }

  // ─── Patrol movement ──────────────────────────────────────────────────────────

  private _updatePatrol(entity: Entity, player: any, tilemap: TilemapLike, events: EventBus, dt: number): void {
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

    // Periodic horizontal shot when player is on the same level and in range
    const dx = player.x - entity.x;
    const dy = player.y - entity.y;
    const patrolShoot = ((entity.params.shootTimer as number | undefined) ?? 2500) - dt;
    entity.params.shootTimer = patrolShoot;
    if (patrolShoot <= 0 && Math.abs(dy) < 20 && Math.abs(dx) < 140) {
      entity.params.shootTimer = 2500;
      const dir = (Math.sign(dx) || 1) as 1 | -1;
      entity.direction = dir;
      this.spawnEnemy({
        id:        `proj_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type:      'enemy',
        archetype: 'projectile',
        x:         Math.floor((entity.x + entity.width  / 2) / tilemap.tileSize),
        y:         Math.floor((entity.y + entity.height / 2) / tilemap.tileSize),
        params:    { vx: dir * 3, vy: 0, lifetime: 1200 },
      });
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

  private _updateChaser(entity: Entity, player: any, tilemap: TilemapLike, events: EventBus, dt: number): void {
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

      // Aimed shot toward player every ~2s while in aggro range
      const chaserShoot = ((entity.params.shootTimer as number | undefined) ?? 2000) - dt;
      entity.params.shootTimer = chaserShoot;
      if (chaserShoot <= 0) {
        entity.params.shootTimer = 2000;
        const angle = Math.atan2(player.y - entity.y, player.x - entity.x);
        const projSpeed = 3;
        this.spawnEnemy({
          id:        `proj_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type:      'enemy',
          archetype: 'projectile',
          x:         Math.floor((entity.x + entity.width  / 2) / tilemap.tileSize),
          y:         Math.floor((entity.y + entity.height / 2) / tilemap.tileSize),
          params:    { vx: Math.cos(angle) * projSpeed, vy: Math.sin(angle) * projSpeed, lifetime: 1000 },
        });
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
      case 'projectile':
        entity = makeEntity({
          id: spec.id,
          type: spec.type,
          archetype: 'projectile',
          x: px,
          y: py,
          width: 5,
          height: 5,
          health: 1,
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

      case 'patrol':
      default:
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
    }

    this.entities.push(entity);
  }

  spawnMaskEnemies(count: number, nearX: number, tilemap: TilemapLike, params?: SpawnParams): void {
    const tileSize = tilemap.tileSize;
    // Spread enemies across a ~200px window centred on nearX
    const spread = 200;
    const startX = Math.max(0, nearX - spread / 2);

    for (let i = 0; i < count; i++) {
      const px = startX + randomFloat(0, spread);
      const placedY = 3 * tileSize; // safe default — entity will fall to ground

      const baseSpeed = params ? 1.5 * params.speed : 1.5;
      const entity = makeEntity({
        id: nextId(),
        type: 'enemy',
        archetype: 'patrol',
        x: px,
        y: placedY,
        width: 12,
        height: 8,
        speed: baseSpeed,
        health: params && params.aggression > 0.3 ? 3 : 2,
        direction: (Math.random() > 0.5 ? 1 : -1) as 1 | -1,
        params: {},
      });

      this.entities.push(entity);
    }
  }

  spawnHealthOrb(x: number, y: number): void {
    const entity = makeEntity({
      id: nextId(),
      type: 'collectible',
      archetype: 'health_orb',
      x,
      y,
      width: 5,
      height: 5,
      health: 1,
      params: { isHealthOrb: true },
    });
    this.entities.push(entity);
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
  private _updateBoss(entity: any, player: any, tilemap: any, events: any, dt: number): void {
    const prevPhase = entity.params.bossPhase ?? 1;
    let phase: number;

    if      (entity.health >= 6) phase = 1;
    else if (entity.health >= 3) phase = 2;
    else                         phase = 3;

    if (phase !== prevPhase) {
      entity.params.bossPhase    = phase;
      entity.params.attackTimer  = 0;
      entity.params.chargeTimer  = 0;
      events.emit('boss_phase_changed', { phase, entity });
    }

    entity.params.bossPhase = phase;

    const dx = player.x - entity.x;
    const dy = player.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    entity.params.proximity = Math.max(0, 1 - dist / 300);

    entity.params.attackTimer  = (entity.params.attackTimer  ?? 0) - dt;
    entity.params.chargeTimer  = (entity.params.chargeTimer  ?? 0) - dt;
    entity.params.slamTimer    = (entity.params.slamTimer    ?? 0) - dt;
    entity.params.minionTimer  = (entity.params.minionTimer  ?? 2000) - dt;

    const baseSpeed = phase === 1 ? 1.2 : phase === 2 ? 1.8 : 2.4;

    if (entity.params.chargeTimer > 0) {
      entity.x += entity.direction * baseSpeed * 2.5;
      if (entity.x < tilemap.tileSize * 2)     entity.direction =  1;
      if (entity.x > tilemap.worldPixelWidth - entity.width - tilemap.tileSize * 2)
                                               entity.direction = -1;
      return;
    }

    if (entity.params.slamTimer > 0) {
      entity.vy = Math.min(entity.vy + 1.2, 18); 
      entity.y += entity.vy;
      return;
    }
    if (entity.params.slamTimer <= 0 && entity.params.wasSlamming) {
      entity.params.wasSlamming = false;
      entity.vy = 0;
      events.emit('boss_slam_landed', { entity });
    }

    if (phase === 3 && entity.params.minionTimer <= 0) {
      entity.params.minionTimer = 4000;
      events.emit('boss_summon_minions', { entity, count: 2 });
    }

    entity.vx = Math.sign(dx) * baseSpeed;
    entity.vy += 0.5;
    entity.vy  = Math.min(entity.vy, 10);
    entity.x  += entity.vx;
    entity.y  += entity.vy;

    const groundTile = tilemap.getTileAt(
      Math.floor((entity.x + entity.width / 2) / tilemap.tileSize),
      Math.floor((entity.y + entity.height + 2) / tilemap.tileSize),
    );
    if (groundTile === 1 && entity.vy > 0) {
      entity.y  = Math.floor((entity.y + entity.height) / tilemap.tileSize) * tilemap.tileSize - entity.height;
      entity.vy = 0;
    }

    entity.direction = dx >= 0 ? 1 : -1;

    if (entity.params.attackTimer <= 0) {
      const attackInterval = phase === 1 ? 3000 : phase === 2 ? 2000 : 1500;
      entity.params.attackTimer = attackInterval;

      if (dist < 300) {
        if (phase === 1 || Math.random() > 0.4) {
          entity.direction        = dx >= 0 ? 1 : -1;
          entity.params.chargeTimer = 600;
        } else {
          entity.vy                  = -10;
          entity.params.slamTimer    = 400;
          entity.params.wasSlamming  = true;
          entity.y                  -= 10;
        }
      }
    }
  }

  private _updateTurret(entity: any, player: any, tilemap: any, events: any, dt: number): void {
    const dx = player.x + player.width  / 2 - (entity.x + entity.width  / 2);
    const dy = player.y + player.height / 2 - (entity.y + entity.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const range = entity.params.range ?? 200;

    if (dist > range) return; 

    entity.params.angle = Math.atan2(dy, dx);
    entity.direction    = dx >= 0 ? 1 : -1;

    const interval = entity.params.fireInterval ?? 2000;
    entity.params.fireTimer = (entity.params.fireTimer ?? interval) - dt;

    if (entity.params.fireTimer <= 0) {
      entity.params.fireTimer = interval;

      const angle  = entity.params.angle;
      const speed  = 3.5;
      const projVx = Math.cos(angle) * speed;
      const projVy = Math.sin(angle) * speed;

      const barrelLen = 6;
      this.spawnEnemy({
        id:        `proj_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type:      'enemy',       
        archetype: 'projectile',
        x:         Math.floor((entity.x + entity.width  / 2 + Math.cos(angle) * barrelLen) / tilemap.tileSize),
        y:         Math.floor((entity.y + entity.height / 2 + Math.sin(angle) * barrelLen) / tilemap.tileSize),
        params:    { vx: projVx, vy: projVy, lifetime: 1500, fromTurret: true },
      });

      events.emit('turret_fired', { entity });
    }
  }

  private _updateProjectile(entity: any, player: any, tilemap: any, dt: number, events: EventBus): void {
    const vx = entity.params.vx ?? 0;
    const vy = entity.params.vy ?? 0;

    entity.x += vx;
    entity.y += vy;

    entity.params.lifetime = (entity.params.lifetime ?? 0) - dt;

    if (entity.params.lifetime <= 0) { entity.active = false; return; }

    if (entity.params.fromPlayer) {
      for (const other of this.entities) {
        if (!other.active || other === entity) continue;
        if (other.archetype === 'projectile') continue;
        if (other.type !== 'enemy') continue;
        if (!overlapsRect(
          entity.x, entity.y, entity.width, entity.height,
          other.x, other.y, other.width, other.height,
        )) continue;
        other.health -= 1;
        entity.active = false;
        events.emit('play_sound', { id: 'coin' });
        if (other.health <= 0) {
          other.active = false;
          events.emit('enemy_killed', { entity: other });
        }
        return;
      }
    } else {
      // Enemy projectile — damages player on contact
      if (overlapsRect(entity.x, entity.y, entity.width, entity.height,
                       player.x, player.y, player.width, player.height)) {
        entity.active = false;
        events.emit('player_damaged_by_enemy', { entity });
        return;
      }
    }

    const tile = tilemap.getTileAt(
      Math.floor((entity.x + entity.width  / 2) / tilemap.tileSize),
      Math.floor((entity.y + entity.height / 2) / tilemap.tileSize),
    );
    if (tile === 1) entity.active = false;

    if (
      entity.x < 0 || entity.x > tilemap.worldPixelWidth ||
      entity.y < 0 || entity.y > tilemap.worldPixelHeight
    ) entity.active = false;
  }

  private _updateFlyerUpgraded(entity: any, player: any, tilemap: any, dt: number): void {
    const flyerState = entity.params.flyerState ?? 'patrol';
    const dx = player.x - entity.x;
    const dy = player.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const aggroRange = 100;

    entity.params.diveTimer    = (entity.params.diveTimer    ?? 0) - dt;
    entity.params.retreatTimer = (entity.params.retreatTimer ?? 0) - dt;

    switch (flyerState) {
      case 'patrol': {
        entity.x   += entity.speed;
        entity.y    = entity.baseY + Math.sin(performance.now() * 0.001 * entity.freq * 60) * entity.amp;

        if (entity.x > tilemap.worldPixelWidth - entity.width || entity.x < 0) {
          entity.speed *= -1;
        }

        if (dist < aggroRange && dy > 20) {
          entity.params.flyerState = 'dive';
          entity.params.diveTimer  = 600;
          entity.params.diveVx     = (dx / dist) * 4;
          entity.params.diveVy     = (dy / dist) * 5;
        }
        break;
      }
      case 'dive': {
        entity.x += entity.params.diveVx;
        entity.y += entity.params.diveVy;

        if (entity.params.diveTimer <= 0) {
          entity.params.flyerState  = 'retreat';
          entity.params.retreatTimer = 800;
        }
        break;
      }
      case 'retreat': {
        entity.y -= 3;
        entity.x += entity.speed * 0.5;

        if (entity.params.retreatTimer <= 0) {
          entity.baseY              = Math.min(entity.y, entity.baseY);
          entity.params.flyerState  = 'patrol';
        }
        break;
      }
    }
  }
}
