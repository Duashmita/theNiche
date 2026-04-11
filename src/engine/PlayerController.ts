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
  
  // ── Ground pound ──────────────────────────────────────────────────
  private isGroundPounding = false;
  private groundPoundUsed  = false;
  private readonly GROUND_POUND_SPEED = 14;

  // ── Wall jump ─────────────────────────────────────────────────────
  private wallJumpCooldown = 0;
  private readonly WALL_JUMP_FORCE_X = 8;
  private readonly WALL_JUMP_FORCE_Y = -13;

  // ── Grapple ───────────────────────────────────────────────────────
  public  grappleActive  = false; 
  public  grappleX       = 0;
  public  grappleY       = 0;
  private grappleTimer   = 0;
  private readonly GRAPPLE_RANGE    = 180;
  private readonly GRAPPLE_PULL     = 0.55;
  private readonly GRAPPLE_DURATION = 700;
  private grappleCooldown = 0;
  private readonly GRAPPLE_COOLDOWN = 1200;

  // ── Size change (Left Shift on ground: cycles normal → small → large) ───────
  private sizeStage = 0; // 0 normal, 1 small, 2 large
  private sizeToggleCooldown = 0;
  private readonly SIZE_COOLDOWN = 350;
  private readonly NORMAL_WIDTH  = 8;
  private readonly NORMAL_HEIGHT = 12;
  private readonly SMALL_WIDTH   = 5;
  private readonly SMALL_HEIGHT  = 8;
  private readonly LARGE_WIDTH   = 14;
  private readonly LARGE_HEIGHT  = 20;

  // Physics sets these; PlayerController reads them for wall interactions
  wallTouchLeft = false;
  wallTouchRight = false;

  // ── Mario-like constants (snappy, low float) ───────────────────────────────
  private readonly ACCEL = 0.72;
  private readonly DECEL = 0.82;
  private readonly MAX_SPEED = 4.6;
  private readonly JUMP_FORCE = -13.2;
  private readonly GRAVITY_SCALE = 1.0;
  private readonly MAX_FALL = 11;
  private readonly COYOTE_MS = 80;
  private readonly JUMP_CUT = -4;

  /** Active melee swing window (ms); EntitySystem applies hitbox while > 0. */
  meleeTimer = 0;
  shootCooldown = 0;

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

    this.sizeStage = 0;
    this.applySizeFromStage();

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
    this.meleeTimer = 0;
    this.shootCooldown = 0;

    this.abilities = new Set(spec.abilities);
  }

  hasAbility(id: AbilityId): boolean {
    return this.abilities.has(id);
  }

  /**
   * Called by the game loop with a spec + tilemap that have already been
   * initialised together. We extract the spawn point from the spec stored
   * inside the tilemap to avoid passing MapSpec separately.
   */
  initFromSpec(spec: PlayerSpec, spawnTileX: number, spawnTileY: number, tileSize: number): void {
    this.sizeStage = 0;
    this.applySizeFromStage();

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
    this.meleeTimer = 0;
    this.shootCooldown = 0;

    this.abilities = new Set(spec.abilities);
  }

  private applySizeFromStage(): void {
    if (this.sizeStage === 1) {
      this.width  = this.SMALL_WIDTH;
      this.height = this.SMALL_HEIGHT;
    } else if (this.sizeStage === 2) {
      this.width  = this.LARGE_WIDTH;
      this.height = this.LARGE_HEIGHT;
    } else {
      this.width  = this.NORMAL_WIDTH;
      this.height = this.NORMAL_HEIGHT;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  update(input: any, events: any, state: any, tilemap: any, dt: number): void {
    if (!this.alive) return;

    const now     = performance.now();
    const gravity = state.gravity;

    // ── HORIZONTAL ───────────────────────────────────────────────────────────
    if (!this.isDashing && !this.isGroundPounding) {
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
      this.vx = Math.max(-this.MAX_SPEED, Math.min(this.vx, this.MAX_SPEED));
      this.vx += (state.windX ?? 0) * (dt / 16.67);
    }

    // ── GRAVITY ──────────────────────────────────────────────────────────────
    if (!this.isDashing && !this.grappleActive) {
      this.vy += gravity * this.GRAVITY_SCALE;
      if (gravity >= 0) this.vy = Math.min(this.vy, this.MAX_FALL);
      else              this.vy = Math.max(this.vy, -this.MAX_FALL);
    }

    // ── FLY (glide ability — hold F in mid-air) ───────────────────────────────
    if (
      this.abilities.has('glide') &&
      !this.onGround &&
      !this.isDashing &&
      !this.grappleActive &&
      input.fly
    ) {
      const thrust = 0.028 * dt;
      if (gravity >= 0) {
        this.vy *= 0.88;
        this.vy -= thrust;
        if (this.vy > 2.8) this.vy = 2.8;
      } else {
        this.vy *= 0.88;
        this.vy += thrust;
        if (this.vy < -2.8) this.vy = -2.8;
      }
    }

    // ── COYOTE TIME ──────────────────────────────────────────────────────────
    if (this.onGround) this.lastGroundedAt = now;
    const canCoyoteJump = (now - this.lastGroundedAt) < this.COYOTE_MS;

    // ── JUMP ─────────────────────────────────────────────────────────────────
    if (input.jumpBuffered && canCoyoteJump && !this.isDashing) {
      this.vy = this.JUMP_FORCE * Math.sign(gravity);
      this.lastGroundedAt    = 0;
      this.doubleJumpAvailable = true;
      this.doubleJumpUsed    = false;
      this.groundPoundUsed   = false;
      input.consumeJump();
      events.emit('player_jumped', { vx: this.vx });
    }

    // ── GROUND POUND — Left Shift in air (Mario slam) ──────────────────────────
    else if (
      input.shiftLeftBuffered &&
      this.abilities.has('ground_pound') &&
      !this.onGround &&
      !this.isGroundPounding &&
      !this.groundPoundUsed
    ) {
      this.isGroundPounding = true;
      this.groundPoundUsed  = true;
      this.vx = 0;
      this.vy = this.GROUND_POUND_SPEED * Math.sign(gravity);
      input.consumeShiftLeft();
      events.emit('player_ground_pound_start', {});
    }

    // ── DOUBLE JUMP ───────────────────────────────────────────────────────────
    else if (
      input.jumpBuffered &&
      this.abilities.has('double_jump') &&
      !this.onGround &&
      !this.doubleJumpUsed &&
      !this.isDashing
    ) {
      this.vy = this.JUMP_FORCE * 0.85 * Math.sign(gravity);
      this.doubleJumpUsed = true;
      this.groundPoundUsed = false;
      input.consumeJump();
      events.emit('player_jumped', { vx: this.vx, isDoubleJump: true });
    }

    // ── WALL JUMP ───────────────────────────────────────────────────────
    else if (
      input.jumpBuffered &&
      this.abilities.has('wall_jump') &&
      !this.onGround &&
      this.wallJumpCooldown <= 0 &&
      (this.wallTouchLeft || this.wallTouchRight)
    ) {
      const wallDir = this.wallTouchRight ? -1 : 1; 
      this.vx = wallDir * this.WALL_JUMP_FORCE_X;
      this.vy = this.WALL_JUMP_FORCE_Y * Math.sign(gravity);
      this.facing = wallDir === 1 ? 'right' : 'left';
      this.wallJumpCooldown = 300;
      this.doubleJumpUsed   = false;
      this.groundPoundUsed  = false;
      input.consumeJump();
      events.emit('player_jumped', { vx: this.vx, isWallJump: true });
    }

    // ── VARIABLE JUMP HEIGHT ─────────────────────────────────────────────────
    if (!input.jump) {
      if (gravity > 0 && this.vy < this.JUMP_CUT)      this.vy = this.JUMP_CUT;
      else if (gravity < 0 && this.vy > -this.JUMP_CUT) this.vy = -this.JUMP_CUT;
    }

    // ── WALL SLIDE ────────────────────────────────────────────────────────────
    let wallSliding = false;
    if (this.abilities.has('wall_slide') && !this.onGround && !this.isDashing) {
      const touchingWall = (this.wallTouchLeft && input.left) || (this.wallTouchRight && input.right);
      if (touchingWall) {
        if (gravity > 0 && this.vy > this.wallSlideVy)       this.vy = this.wallSlideVy;
        else if (gravity < 0 && this.vy < -this.wallSlideVy) this.vy = -this.wallSlideVy;
        wallSliding = true;
      }
    }

    // ── DASH ──────────────────────────────────────────────────────────────────
    if (
      this.abilities.has('dash') &&
      input.dashBuffered &&
      this.dashCooldown <= 0 &&
      !this.isDashing
    ) {
      this.isDashing  = true;
      this.dashTimer  = this.DASH_DURATION;
      this.dashCooldown = this.DASH_COOLDOWN;
      this.vx = (this.facing === 'right' ? 1 : -1) * this.DASH_SPEED;
      this.vy = 0;
      input.consumeDash();
      events.emit('player_dashed', { facing: this.facing });
    }

    if (this.isDashing) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) { this.isDashing = false; this.vx *= 0.3; }
    }
    this.dashCooldown    = Math.max(0, this.dashCooldown    - dt);
    this.wallJumpCooldown = Math.max(0, this.wallJumpCooldown - dt);

    if (this.isGroundPounding && this.onGround) {
      this.isGroundPounding = false;
      this.vy = this.JUMP_FORCE * 0.7 * Math.sign(gravity); 
      events.emit('player_ground_pound_land', { x: this.x, y: this.y });
    }

    // ── GRAPPLE ─────────────────────────────────────────────────────────
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);

    if (
      this.abilities.has('grapple') &&
      input.grappleBuffered &&
      !this.isDashing &&
      !this.grappleActive &&
      this.grappleCooldown <= 0
    ) {
      const angle = this.facing === 'right' ? -0.55 : Math.PI + 0.55;
      this.grappleX      = this.x + this.width / 2 + Math.cos(angle) * this.GRAPPLE_RANGE;
      this.grappleY      = this.y + this.height / 2 + Math.sin(angle) * this.GRAPPLE_RANGE;
      this.grappleActive = true;
      this.grappleTimer  = this.GRAPPLE_DURATION;
      input.consumeGrapple();
      events.emit('player_grapple_fired', { x: this.grappleX, y: this.grappleY });
    }

    if (this.grappleActive) {
      this.grappleTimer -= dt;
      const px = this.x + this.width / 2;
      const py = this.y + this.height / 2;
      const dx = this.grappleX - px;
      const dy = this.grappleY - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 6) {
        const nx = dx / dist;
        const ny = dy / dist;
        const tx = -ny;
        const ty = nx;
        const swing = 0.38 * (dt / 16.67);
        const w = Math.min(dist * 0.018, 1.2);
        this.vx += tx * swing * w * 8;
        this.vy += ty * swing * w * 6;
        this.vx += nx * this.GRAPPLE_PULL * 0.45;
        this.vy += ny * this.GRAPPLE_PULL * 0.42;
      }

      const maxG = this.MAX_SPEED * 2.4;
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (speed > maxG) {
        const scale = maxG / speed;
        this.vx *= scale;
        this.vy *= scale;
      }

      if (this.grappleTimer <= 0 || this.onGround || input.jumpBuffered) {
        this.grappleActive  = false;
        this.grappleCooldown = this.GRAPPLE_COOLDOWN;
        events.emit('player_grapple_retracted', {});
      }
    }

    // ── SIZE — Left Shift on ground: normal → small → large → … ────────────────
    this.sizeToggleCooldown = Math.max(0, this.sizeToggleCooldown - dt);

    if (
      this.abilities.has('size_change') &&
      input.shiftLeftBuffered &&
      this.onGround &&
      this.sizeToggleCooldown <= 0
    ) {
      this.sizeStage = (this.sizeStage + 1) % 3;
      this.sizeToggleCooldown = this.SIZE_COOLDOWN;
      input.consumeShiftLeft();
      this.applySizeFromStage();
      events.emit('player_size_changed', { stage: this.sizeStage });
    }

    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);

    // ── Health + energy regen (out of combat) ─────────────────────────────────
    if (!state.inCombat) {
      if (state.health < state.maxHealth) {
        const regen = (state.healthRegenRate ?? 1) * dt / 1000;
        state.health = Math.min(state.maxHealth, state.health + regen);
      }
      if (state.energy < state.maxEnergy) {
        state.energy = Math.min(state.maxEnergy, state.energy + 5 * dt / 1000);
      }
    }

    // ── STATE MACHINE ─────────────────────────────────────────────────────────
    if (this.isGroundPounding)        this.state = 'falling';
    else if (this.grappleActive)      this.state = 'jumping';
    else if (this.onGround && Math.abs(this.vx) > 0.5) this.state = 'running';
    else if (this.onGround)           this.state = 'idle';
    else if (wallSliding)             this.state = 'wall_sliding';
    else if (this.vy < 0)             this.state = 'jumping';
    else                              this.state = 'falling';
    if (this.isDashing)               this.state = 'dashing';
    if (!this.alive)                  this.state = 'dead';
  }
  takeDamage(events: any, state: any): void {
    if (!this.alive) return;
    
    state.health -= 1;
    events.emit('player_took_damage', { health: state.health });

    // Tiny knockback bounce
    this.vy = -6; 
    
    if (state.health <= 0) {
      this.alive = false;
      this.state = 'dead';
      events.emit('player_died', {});
    }
  }
}