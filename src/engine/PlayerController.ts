import { EventBus } from './EventBus';
import { InputSystem } from './InputSystem';
import { Tilemap } from './Tilemap';
import { PlayerSpec, PlayerState, AbilityId, SharedState } from '../types';
import { clamp } from '../utils/math';

export class PlayerController {
  // ── Public properties read by other systems ─────────────────────────────────
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  width = 8;
  height = 12;
  onGround = false;
  lastGroundedAt = 0;
  facing: 'left' | 'right' = 'right';
  state: PlayerState = 'idle';
  scaleX = 1;
  scaleY = 1;
  alive = true;

  // Physics sets these; PlayerController reads them for wall interactions
  wallTouchLeft = false;
  wallTouchRight = false;

  // ── Baked constants — hand-tuned, never changed by LLM ─────────────────────
  private readonly ACCEL = 0.6;
  private readonly DECEL = 0.85;
  private readonly MAX_SPEED = 5.5;
  private readonly JUMP_FORCE = -14.5;
  private readonly GRAVITY_SCALE = 1.0;
  private readonly MAX_FALL = 12;
  private readonly COYOTE_MS = 80;
  private readonly JUMP_CUT = -4;

  // ── Ability state ───────────────────────────────────────────────────────────
  private abilities: Set<AbilityId> = new Set();
  private doubleJumpAvailable = false;
  private doubleJumpUsed = false;
  private dashCooldown = 0;
  private isDashing = false;
  private dashTimer = 0;
  private readonly DASH_SPEED = 12;
  private readonly DASH_DURATION = 120;   // ms
  private readonly DASH_COOLDOWN = 500;   // ms
  private wallSlideVy = 2.5;

  // ── Internal bookkeeping ────────────────────────────────────────────────────
  private spawnX = 0;
  private spawnY = 0;
  private maxHealth = 3;

  // ────────────────────────────────────────────────────────────────────────────

  init(spec: PlayerSpec, tilemap: Tilemap): void {
    const ts = tilemap.tileSize;
    const spawn = (tilemap as any)._spec?.map?.spawnPoint ?? { x: 1, y: 1 };

    // Convert tile coords to pixel: center of tile minus half player width
    this.spawnX = spawn.x * ts + ts / 2 - this.width / 2;
    this.spawnY = spawn.y * ts + ts / 2 - this.height / 2;

    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.onGround = false;
    this.lastGroundedAt = 0;
    this.facing = 'right';
    this.state = 'idle';
    this.scaleX = 1;
    this.scaleY = 1;
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.doubleJumpAvailable = false;
    this.doubleJumpUsed = false;
    this.maxHealth = spec.health;

    this.abilities = new Set(spec.abilities);
  }

  /**
   * Called by the game loop with a spec + tilemap that have already been
   * initialised together. We extract the spawn point from the spec stored
   * inside the tilemap to avoid passing MapSpec separately.
   */
  initFromSpec(spec: PlayerSpec, spawnTileX: number, spawnTileY: number, tileSize: number): void {
    this.spawnX = spawnTileX * tileSize + tileSize / 2 - this.width / 2;
    this.spawnY = spawnTileY * tileSize + tileSize / 2 - this.height / 2;

    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.onGround = false;
    this.lastGroundedAt = 0;
    this.facing = 'right';
    this.state = 'idle';
    this.scaleX = 1;
    this.scaleY = 1;
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.doubleJumpAvailable = false;
    this.doubleJumpUsed = false;
    this.maxHealth = spec.health;

    this.abilities = new Set(spec.abilities);
  }

  // ────────────────────────────────────────────────────────────────────────────

  update(input: InputSystem, events: EventBus, state: SharedState, _tilemap: Tilemap): void {
    if (!this.alive) return;

    const now = performance.now();
    const gravity = state.gravity;

    // ── HORIZONTAL ───────────────────────────────────────────────────────────
    if (!this.isDashing) {
      if (input.left) {
        this.vx -= this.ACCEL;
        this.facing = 'left';
      } else if (input.right) {
        this.vx += this.ACCEL;
        this.facing = 'right';
      } else {
        this.vx *= this.DECEL;
        if (Math.abs(this.vx) < 0.1) this.vx = 0;
      }
      this.vx = clamp(this.vx, -this.MAX_SPEED, this.MAX_SPEED);
    }

    // ── GRAVITY ──────────────────────────────────────────────────────────────
    if (!this.isDashing) {
      this.vy += gravity * this.GRAVITY_SCALE;
      if (gravity >= 0) {
        this.vy = Math.min(this.vy, this.MAX_FALL);
      } else {
        // Gravity is flipped — cap in the negative direction
        this.vy = Math.max(this.vy, -this.MAX_FALL);
      }
    }

    // ── COYOTE TIME ──────────────────────────────────────────────────────────
    if (this.onGround) this.lastGroundedAt = now;
    const canCoyoteJump = (now - this.lastGroundedAt) < this.COYOTE_MS;

    // ── JUMP ─────────────────────────────────────────────────────────────────
    if (input.jumpBuffered && canCoyoteJump && !this.isDashing) {
      this.vy = this.JUMP_FORCE * Math.sign(gravity);
      this.lastGroundedAt = 0;
      this.doubleJumpAvailable = true;
      this.doubleJumpUsed = false;
      input.consumeJump();
      events.emit('player_jumped', { vx: this.vx });
    }
    // ── DOUBLE JUMP (if ability loaded) ──────────────────────────────────────
    else if (
      input.jumpBuffered &&
      this.abilities.has('double_jump') &&
      !this.onGround &&
      !this.doubleJumpUsed &&
      !this.isDashing
    ) {
      this.vy = this.JUMP_FORCE * 0.85 * Math.sign(gravity);
      this.doubleJumpUsed = true;
      input.consumeJump();
      events.emit('player_jumped', { vx: this.vx, isDoubleJump: true });
    }

    // ── VARIABLE JUMP HEIGHT ─────────────────────────────────────────────────
    // When the player releases jump early, cap the upward (or downward when
    // gravity flipped) velocity at JUMP_CUT to allow short hops.
    if (!input.jump) {
      if (gravity > 0 && this.vy < this.JUMP_CUT) {
        // Normal gravity: vy is negative while rising. JUMP_CUT is -4.
        // Cap upward velocity so the player doesn't rise as high.
        this.vy = this.JUMP_CUT;
      } else if (gravity < 0 && this.vy > -this.JUMP_CUT) {
        // Flipped gravity: vy is positive while rising (downward in world space).
        this.vy = -this.JUMP_CUT;
      }
    }

    // ── WALL SLIDE (if ability) ───────────────────────────────────────────────
    let wallSliding = false;
    if (this.abilities.has('wall_slide') && !this.onGround && !this.isDashing) {
      const touchingWall =
        (this.wallTouchLeft && input.left) ||
        (this.wallTouchRight && input.right);

      if (touchingWall) {
        if (gravity > 0 && this.vy > this.wallSlideVy) {
          this.vy = this.wallSlideVy;
        } else if (gravity < 0 && this.vy < -this.wallSlideVy) {
          this.vy = -this.wallSlideVy;
        }
        wallSliding = true;
      }
    }

    // ── DASH (if ability) ────────────────────────────────────────────────────
    if (
      this.abilities.has('dash') &&
      input.dashBuffered &&
      this.dashCooldown <= 0 &&
      !this.isDashing
    ) {
      this.isDashing = true;
      this.dashTimer = this.DASH_DURATION;
      this.dashCooldown = this.DASH_COOLDOWN;
      this.vx = (this.facing === 'right' ? 1 : -1) * this.DASH_SPEED;
      this.vy = 0;
      input.consumeDash();
      events.emit('player_dashed', { facing: this.facing });
    }

    // ── DASH TICK ────────────────────────────────────────────────────────────
    if (this.isDashing) {
      this.dashTimer -= 16.6;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        this.vx *= 0.3;
      }
    }
    this.dashCooldown = Math.max(0, this.dashCooldown - 16.6);

    // ── STATE MACHINE ─────────────────────────────────────────────────────────
    if (this.onGround && Math.abs(this.vx) > 0.5) {
      this.state = 'running';
    } else if (this.onGround) {
      this.state = 'idle';
    } else if (wallSliding) {
      this.state = 'wall_sliding';
    } else if (this.vy < 0) {
      this.state = 'jumping';
    } else {
      this.state = 'falling';
    }
    if (this.isDashing) this.state = 'dashing';
    if (!this.alive) this.state = 'dead';
  }

  // ────────────────────────────────────────────────────────────────────────────

  getHitbox(): { x: number; y: number; w: number; h: number } {
    return { x: this.x, y: this.y, w: this.width, h: this.height };
  }

  takeDamage(events: EventBus, state: SharedState): void {
    state.health -= 1;
    events.emit('player_damaged', { newHealth: state.health });
    if (state.health <= 0) {
      this.alive = false;
      this.state = 'dead';
      events.emit('player_died', {});
    }
  }

  respawn(spec: PlayerSpec, tilemap: Tilemap): void {
    // Re-derive spawn from spec stored alongside tilemap if available,
    // otherwise fall back to stored spawnX/spawnY.
    const ts = tilemap.tileSize;

    // Try to get spawn from the GameSpec that lives on the Tilemap
    // (Tilemap does not expose it publicly, so we use spawnX/spawnY set in init).
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.onGround = false;
    this.lastGroundedAt = 0;
    this.facing = 'right';
    this.state = 'idle';
    this.scaleX = 1;
    this.scaleY = 1;
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.doubleJumpAvailable = false;
    this.doubleJumpUsed = false;

    // Restore health
    this.maxHealth = spec.health;
  }
}
