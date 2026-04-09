import { EventBus } from './EventBus';
import { Particle } from '../types';
import { randomFloat } from '../utils/math';
import { TweenManager } from '../utils/tween';

interface ParticleOpts {
  count: number;
  colors: string[];
  speed: number;
  /** 360 = full circle; any other value = downward cone of that angle in degrees */
  spread: number;
  gravity: number;
  lifetime: number;
  size?: number;
}

// Shape of the player object needed for squash/stretch tweens.
// PlayerController exposes these as public properties.
interface PlayerScales {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

export class JuiceSystem {
  // ── Public state read by Renderer ─────────────────────────────────────────────
  public shakeX = 0;
  public shakeY = 0;
  public particles: Particle[] = [];
  public damageFlash = false;

  // ── Private ───────────────────────────────────────────────────────────────────
  private shakeIntensity = 0;
  private readonly SHAKE_DECAY = 0.88;
  private frozen = false;
  private frozenUntil = 0;
  private tweens: TweenManager;
  private player: PlayerScales;

  constructor(events: EventBus, playerScales: PlayerScales) {
    this.tweens = new TweenManager();
    this.player = playerScales;

    // ── Event wiring ─────────────────────────────────────────────────────────────

    events.on('player_jumped', (data: { vx?: number; isDoubleJump?: boolean; x?: number; y?: number; width?: number; height?: number }) => {
      if (data?.isDoubleJump) {
        // Double-jump: particle ring around player centre
        this._spawnParticles(
          this.player.x + this.player.width / 2,
          this.player.y + this.player.height / 2,
          { count: 8, colors: ['#88ccff'], speed: 2.5, spread: 360, gravity: 0, lifetime: 280, size: 2 },
        );
      } else {
        // Normal jump: squash then stretch
        this.tweens.to(this.player as unknown as Record<string, number>, 'scaleX', 0.8, 50, {
          onComplete: () => this.tweens.to(this.player as unknown as Record<string, number>, 'scaleX', 1.0, 100),
        });
        this.tweens.to(this.player as unknown as Record<string, number>, 'scaleY', 1.3, 50, {
          onComplete: () => this.tweens.to(this.player as unknown as Record<string, number>, 'scaleY', 1.0, 100),
        });

        // Foot dust
        this._spawnParticles(
          this.player.x + this.player.width / 2,
          this.player.y + this.player.height,
          { count: 4, colors: ['#ffffff', '#aaaaff'], speed: 1.5, spread: 180, gravity: 0.2, lifetime: 200, size: 2 },
        );
      }
    });

    events.on('player_landed', (data: { vy: number; tileX?: number; tileY?: number }) => {
      if (!data) return;
      if (data.vy > 6) this.shakeIntensity = 3;

      this.tweens.to(this.player as unknown as Record<string, number>, 'scaleX', 1.3, 60, {
        onComplete: () => this.tweens.to(this.player as unknown as Record<string, number>, 'scaleX', 1.0, 90),
      });
      this.tweens.to(this.player as unknown as Record<string, number>, 'scaleY', 0.75, 60, {
        onComplete: () => this.tweens.to(this.player as unknown as Record<string, number>, 'scaleY', 1.0, 90),
      });

      // Dust spreading left and right
      this._spawnParticles(
        this.player.x + this.player.width / 2,
        this.player.y + this.player.height,
        { count: data.vy > 6 ? 6 : 4, colors: ['#cccccc', '#aaaaaa', '#888888'], speed: 2, spread: 160, gravity: -0.05, lifetime: 250, size: 2 },
      );
    });

    events.on('enemy_killed', (data: { entity: { x: number; y: number; width: number; height: number } }) => {
      if (!data?.entity) return;
      const e = data.entity;

      this.shakeIntensity = 5;
      this.frozen = true;
      this.frozenUntil = performance.now() + 50;

      this._spawnParticles(
        e.x + e.width / 2,
        e.y + e.height / 2,
        { count: 10, colors: ['#ff4444', '#ff8844', '#ffffff'], spread: 360, speed: randomFloat(3, 5), gravity: 0.4, lifetime: 400, size: 3 },
      );
    });

    events.on('collectible_picked_up', (data: { entity: { x: number; y: number; width: number; height: number } }) => {
      if (!data?.entity) return;
      const e = data.entity;

      this._spawnParticles(
        e.x + e.width / 2,
        e.y + e.height / 2,
        { count: 6, colors: ['#ffcc44', '#ffffff'], speed: 2, spread: 360, gravity: 0.2, lifetime: 350, size: 3 },
      );
    });

    events.on('player_damaged', (_data: { newHealth: number }) => {
      this.shakeIntensity = 7;
      this.damageFlash = true;
      setTimeout(() => { this.damageFlash = false; }, 100);
    });

    events.on('gravity_flipped', (_data: { flipped: boolean }) => {
      this.shakeIntensity = 4;
      this._spawnParticles(
        this.player.x + this.player.width / 2,
        this.player.y + this.player.height / 2,
        { count: 12, colors: ['#aaaaff'], speed: 2, spread: 360, gravity: 0, lifetime: 400, size: 2 },
      );
    });

    events.on('voice_moment_triggered', (_data: unknown) => {
      this.shakeIntensity = 1;
    });

    events.on('checkpoint_reached', (data: { entity: { x: number; y: number; width: number; height: number } }) => {
      if (!data?.entity) return;
      const e = data.entity;

      this._spawnParticles(
        e.x + e.width / 2,
        e.y + e.height / 2,
        { count: 12, colors: ['#44ff44', '#ffffff'], speed: 2, spread: 360, gravity: -0.1, lifetime: 600, size: 3 },
      );
    });
  }

  // ── Per-frame update ──────────────────────────────────────────────────────────

  update(dt: number): void {
    // Shake decay
    this.shakeIntensity *= this.SHAKE_DECAY;
    this.shakeX = (Math.random() - 0.5) * 2 * this.shakeIntensity;
    this.shakeY = (Math.random() - 0.5) * 2 * this.shakeIntensity;

    // Update particles
    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.life -= dt;
      return p.life > 0;
    });

    // Hitstop — unfreeze when timer expires
    if (this.frozen && performance.now() > this.frozenUntil) {
      this.frozen = false;
    }

    // Drive squash/stretch tweens
    this.tweens.update(dt);
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  // ── Particle spawner ──────────────────────────────────────────────────────────

  private _spawnParticles(x: number, y: number, opts: ParticleOpts): void {
    for (let i = 0; i < opts.count; i++) {
      const angle = opts.spread === 360
        ? Math.random() * Math.PI * 2
        : Math.PI + (Math.random() - 0.5) * (opts.spread / 180 * Math.PI);

      const speed = randomFloat(opts.speed * 0.6, opts.speed * 1.4);

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: opts.gravity,
        life: opts.lifetime * randomFloat(0.7, 1.3),
        maxLife: opts.lifetime,
        color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
        size: opts.size ?? 2,
      });
    }
  }

  // Expose for any external caller that needs to trigger particles directly
  spawnParticles(x: number, y: number, opts: ParticleOpts): void {
    this._spawnParticles(x, y, opts);
  }
}
