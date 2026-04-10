import {
  SharedState,
  Entity,
  THEME_PALETTES,
  ThemeId,
  GameSpec,
  TileType,
  Particle,
  AssetMap,
} from '../types';
import { clamp } from '../utils/math';

// ─── Forward-compatible minimal interfaces ────────────────────────────────────

/**
 * Properties of PlayerController that the Renderer needs.
 * The real implementation will satisfy this interface.
 */
interface PlayerLike {
  x: number;
  y: number;
  width: number;   // nominal: 8
  height: number;  // nominal: 12
  scaleX: number;
  scaleY: number;
  facing: 'left' | 'right';
  state: string;   // PlayerState
  vx: number;
  vy: number;
}

/**
 * Properties of JuiceSystem that the Renderer reads.
 */
interface JuiceLike {
  shakeX: number;
  shakeY: number;
  particles: Particle[];
}

/**
 * Properties of Camera that the Renderer reads.
 */
interface CameraLike {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
  isVisible(px: number, py: number, pw: number, ph: number): boolean;
}

/**
 * Properties of Tilemap that the Renderer reads.
 */
interface TilemapLike {
  tileSize: number;
  mapWidth: number;
  mapHeight: number;
  visualTiles: number[][];
  isTriggerFired(col: number, row: number): boolean;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class Renderer {
  private readonly nativeCanvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private readonly displayCanvas: HTMLCanvasElement;
  private readonly displayCtx: CanvasRenderingContext2D;

  constructor(nativeCanvas: HTMLCanvasElement, displayCanvas: HTMLCanvasElement) {
    this.nativeCanvas  = nativeCanvas;
    this.displayCanvas = displayCanvas;

    this.ctx        = nativeCanvas.getContext('2d')!;
    this.displayCtx = displayCanvas.getContext('2d')!;

    // CRITICAL: pixel-art upscaling must be crisp, not blurry
    this.ctx.imageSmoothingEnabled        = false;
    this.displayCtx.imageSmoothingEnabled = false;
  }

  // ─── Generated asset map (swapped in after Imagen calls resolve) ──────────
  private assets: AssetMap = new Map();

  setAssets(assets: AssetMap): void { this.assets = assets; }

  patchAssets(partial: AssetMap): void {
    partial.forEach((img, key) => this.assets.set(key, img));
  }

  private getAsset(themeId: ThemeId, type: string): HTMLImageElement | undefined {
    return this.assets.get(`${themeId}/${type}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main render entry point
  // ─────────────────────────────────────────────────────────────────────────

  render(
    state: SharedState,
    player: PlayerLike,
    entities: Entity[],
    tilemap: TilemapLike,
    camera: CameraLike,
    juice: JuiceLike,
  ): void {
    const ctx    = this.ctx;
    const spec   = state.spec;
    const themeId: ThemeId = (spec?.theme?.tileset as ThemeId) ?? 'forest';
    const palette = THEME_PALETTES[themeId];

    // 1. Clear native canvas with theme background colour
    ctx.fillStyle = spec?.theme?.backgroundColor ?? palette.bg;
    ctx.fillRect(0, 0, this.nativeCanvas.width, this.nativeCanvas.height);

    // 2. Save context and apply camera + screen-shake transform
    ctx.save();
    ctx.translate(
      Math.round(-camera.x + juice.shakeX),
      Math.round(-camera.y + juice.shakeY),
    );

    // 3. Parallax background (drawn in world space but scrolls slower)
    this.drawParallax(ctx, camera, themeId, palette.bg, state.frameCount);

    // 4. Visible tiles
    this.drawVisibleTiles(ctx, tilemap, camera, themeId, state);

    // 5. Entities (drawn before player so player is always on top)
    for (const entity of entities) {
      if (!entity.active) continue;
      if (!camera.isVisible(entity.x, entity.y, entity.width, entity.height)) continue;
      this.drawEntity(ctx, entity, palette, state.frameCount, themeId);
    }

    // 6. Player
    this.drawPlayer(ctx, player, state, palette);

    // ── Grapple cable ─────────────────────────────────────────────────────────
    if ((player as any).grappleActive) {
      const gx = (player as any).grappleX;
      const gy = (player as any).grappleY;
      const px = player.x + player.width  / 2;
      const py = player.y + player.height / 2;

      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#ffffff'; // White cable
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.restore();

      // Hook dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 7. Restore from camera transform
    ctx.restore();

    this.drawBrightnessOverlay(ctx, state);

    // 8. Particles — screen-space (no camera offset)
    this.drawParticles(ctx, juice.particles, camera);

    // 9. HUD overlay (screen-space)
    if (spec) {
      this.drawUI(ctx, state, player, spec);
    }

    // 10. Scale the native canvas up to the display canvas
    this.displayCtx.drawImage(
      this.nativeCanvas,
      0, 0,
      this.displayCanvas.width,
      this.displayCanvas.height,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Parallax background
  // ─────────────────────────────────────────────────────────────────────────

  private drawParallax(
    ctx: CanvasRenderingContext2D,
    camera: CameraLike,
    themeId: ThemeId,
    bgColor: string,
    frameCount: number,
  ): void {
    // Distant layer scrolls at 20% of camera speed (parallax factor = 0.2)
    const parallaxFactor = 0.2;
    const px = camera.x * parallaxFactor;
    const py = camera.y * parallaxFactor;

    // Draw a subtle gradient layer filling the entire world viewport
    const gx = camera.x;
    const gy = camera.y;
    const gw = camera.screenWidth;
    const gh = camera.screenHeight;

    const grad = ctx.createLinearGradient(gx, gy, gx, gy + gh);

    // Theme-specific gradient colours for the sky / deep background
    switch (themeId) {
      case 'forest':
        grad.addColorStop(0, '#050e05');
        grad.addColorStop(1, '#0d1b0d');
        break;
      case 'dungeon':
        grad.addColorStop(0, '#07070f');
        grad.addColorStop(1, '#0d0d14');
        break;
      case 'space':
        grad.addColorStop(0, '#02020a');
        grad.addColorStop(1, '#03030a');
        break;
      case 'underwater':
        grad.addColorStop(0, '#020810');
        grad.addColorStop(1, '#041020');
        break;
      case 'city':
        grad.addColorStop(0, '#080810');
        grad.addColorStop(1, '#0a0a14');
        break;
      case 'ice':
        grad.addColorStop(0, '#040a10');
        grad.addColorStop(1, '#080f1a');
        break;
      default:
        grad.addColorStop(0, bgColor);
        grad.addColorStop(1, bgColor);
    }

    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw, gh);

    const bgImg = this.getAsset(themeId, 'background');
    const hasBgImage = !!(bgImg && bgImg.complete && bgImg.naturalWidth > 0);
    if (hasBgImage && bgImg) {
      const destH = gh;
      const destW = (bgImg.naturalWidth / bgImg.naturalHeight) * destH;
      const mod = ((px % destW) + destW) % destW;
      const prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.94;
      let tx = gx - mod;
      while (tx < gx + gw + destW) {
        ctx.drawImage(bgImg, tx, gy, destW, destH);
        tx += destW;
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = prevSmooth;
    }

    // Stars / ambient dots when no generated backdrop (avoids clutter on landscapes)
    if (!hasBgImage) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      const STAR_COUNT = 32;
      for (let i = 0; i < STAR_COUNT; i++) {
        const sx = ((i * 137 + 53) % 400) - px % 400;
        const sy = ((i * 97  + 71) % 200) - py % 200;
        const size = (i % 3 === 0) ? 1.5 : 1;
        ctx.fillRect(gx + ((sx + 400) % camera.screenWidth), gy + ((sy + 200) % camera.screenHeight), size, size);
      }
    }

    // For underwater theme: add gentle caustic shimmer lines
    if (themeId === 'underwater') {
      ctx.strokeStyle = 'rgba(64,200,220,0.05)';
      ctx.lineWidth = 1;
      const wave = Math.sin(frameCount * 0.02) * 4;
      for (let i = 0; i < 6; i++) {
        const ly = gy + (i / 6) * gh + wave;
        ctx.beginPath();
        ctx.moveTo(gx, ly);
        ctx.lineTo(gx + gw, ly + 8);
        ctx.stroke();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tile drawing
  // ─────────────────────────────────────────────────────────────────────────

  private drawVisibleTiles(
    ctx: CanvasRenderingContext2D,
    tilemap: TilemapLike,
    camera: CameraLike,
    themeId: ThemeId,
    state: SharedState,
  ): void {
    const ts      = tilemap.tileSize;
    const palette = THEME_PALETTES[themeId];
    const fc      = state.frameCount;

    // Determine the range of columns/rows visible in the camera viewport
    const colStart = Math.max(0, Math.floor(camera.x / ts));
    const colEnd   = Math.min(tilemap.mapWidth  - 1, Math.ceil((camera.x + camera.screenWidth)  / ts));
    const rowStart = Math.max(0, Math.floor(camera.y / ts));
    const rowEnd   = Math.min(tilemap.mapHeight - 1, Math.ceil((camera.y + camera.screenHeight) / ts));

    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const tile = tilemap.visualTiles[row]?.[col] ?? TileType.AIR;
        if (tile === TileType.AIR) continue;

        const wx = col * ts;
        const wy = row * ts;

        switch (tile) {
          // ── Ground (SOLID) ────────────────────────────────────────────────
          case TileType.GROUND: {
            const groundImg = this.getAsset(themeId, 'ground');
            if (groundImg) {
              ctx.drawImage(groundImg, wx, wy, ts, ts);
            } else {
              // Base fill
              ctx.fillStyle = palette.ground;
              ctx.fillRect(wx, wy, ts, ts);
              // 2px lighter top face to give a "lit from above" feel
              ctx.fillStyle = palette.groundTop;
              ctx.fillRect(wx, wy, ts, 2);
              // 1px darker right-edge shadow
              ctx.fillStyle = 'rgba(0,0,0,0.25)';
              ctx.fillRect(wx + ts - 1, wy + 2, 1, ts - 2);
            }
            break;
          }

          // ── Platform (one-way) ────────────────────────────────────────────
          case TileType.PLATFORM: {
            const platformImg = this.getAsset(themeId, 'platform');
            if (platformImg) {
              ctx.drawImage(platformImg, wx, wy + 2, ts, ts - 2);
            } else {
              // Thin floating plank
              ctx.fillStyle = palette.platform;
              ctx.fillRect(wx, wy + 2, ts, ts - 2);
              // 3px bright stripe across the very top
              ctx.fillStyle = this.lighten(palette.platform, 40);
              ctx.fillRect(wx, wy + 2, ts, 3);
              // Subtle underside shadow
              ctx.fillStyle = 'rgba(0,0,0,0.35)';
              ctx.fillRect(wx, wy + ts - 2, ts, 2);
            }
            break;
          }

          // ── Hazard (spikes) ───────────────────────────────────────────────
          case TileType.HAZARD: {
            const hazardImg = this.getAsset(themeId, 'hazard');
            if (hazardImg) {
              const hazardAlpha = Math.sin(fc * 0.1) * 0.3 + 0.7;
              ctx.globalAlpha = hazardAlpha;
              ctx.drawImage(hazardImg, wx, wy, ts, ts);
              ctx.globalAlpha = 1;
            } else {
              // Pulsing alpha base
              const hazardAlpha = Math.sin(fc * 0.1) * 0.3 + 0.7;

              ctx.fillStyle = palette.hazard;
              ctx.globalAlpha = hazardAlpha;
              ctx.fillRect(wx, wy + 4, ts, ts - 4);
              ctx.globalAlpha = 1;

              // Draw 4 spike triangles pointing upward
              ctx.fillStyle = this.lighten(palette.hazard, 20);
              const spikeCount = 4;
              const spikeWidth = ts / spikeCount;
              for (let s = 0; s < spikeCount; s++) {
                const sx = wx + s * spikeWidth;
                ctx.beginPath();
                ctx.moveTo(sx,                     wy + 4);   // base left
                ctx.lineTo(sx + spikeWidth,        wy + 4);   // base right
                ctx.lineTo(sx + spikeWidth / 2,    wy);       // tip
                ctx.closePath();
                ctx.fill();
              }

              // Pulse overlay
              ctx.fillStyle = palette.hazard;
              ctx.globalAlpha = (1 - hazardAlpha) * 0.4;
              ctx.fillRect(wx, wy, ts, ts);
              ctx.globalAlpha = 1;
            }
            break;
          }

          // ── Door (solid until voice-moment unlocks) ───────────────────────
          case TileType.DOOR: {
            const stripeW = 4;
            const stripeCount = Math.ceil(ts / stripeW);
            for (let s = 0; s < stripeCount; s++) {
              ctx.fillStyle = s % 2 === 0 ? palette.door : this.lighten(palette.door, 30);
              ctx.fillRect(wx + s * stripeW, wy, stripeW, ts);
            }
            // Door frame (1px border)
            ctx.strokeStyle = this.lighten(palette.door, 50);
            ctx.lineWidth = 1;
            ctx.strokeRect(wx + 0.5, wy + 0.5, ts - 1, ts - 1);
            break;
          }

          // ── Trigger (invisible shimmer) ───────────────────────────────────
          case TileType.TRIGGER: {
            // Only draw if the trigger hasn't fired yet
            if (!tilemap.isTriggerFired(col, row)) {
              const shimmerAlpha = Math.sin(fc * 0.08) * 0.4 + 0.6;
              ctx.strokeStyle = palette.trigger;
              ctx.lineWidth = 1;
              ctx.globalAlpha = shimmerAlpha * 0.5;
              ctx.strokeRect(wx + 1, wy + 1, ts - 2, ts - 2);
              ctx.globalAlpha = shimmerAlpha * 0.15;
              ctx.fillStyle = palette.trigger;
              ctx.fillRect(wx + 1, wy + 1, ts - 2, ts - 2);
              ctx.globalAlpha = 1;
            }
            break;
          }

          // ── Decoration (visual only, no collision) ────────────────────────
          case TileType.DECORATION: {
            const decorImg = this.getAsset(themeId, 'decoration');
            if (decorImg) {
              ctx.drawImage(decorImg, wx + 3, wy + 4, ts - 6, ts - 4);
            } else {
              ctx.fillStyle = 'rgba(120,80,40,0.6)';
              ctx.fillRect(wx + 3, wy + 4, ts - 6, ts - 4);
            }
            break;
          }

          // ── Ladder ────────────────────────────────────────────────────────
          case TileType.LADDER: {
            // Two vertical rails + horizontal rungs
            ctx.fillStyle = 'rgba(180,120,60,0.8)';
            ctx.fillRect(wx + 3,      wy, 2, ts);  // left rail
            ctx.fillRect(wx + ts - 5, wy, 2, ts);  // right rail
            ctx.fillStyle = 'rgba(200,140,70,0.9)';
            for (let r = 3; r < ts; r += 4) {
              ctx.fillRect(wx + 3, wy + r, ts - 6, 1);
            }
            break;
          }

          default:
            break;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Player drawing
  // ─────────────────────────────────────────────────────────────────────────

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: PlayerLike,
    state: SharedState,
    palette: ReturnType<typeof this.getPalette>,
  ): void {
    const fc = state.frameCount;
    const isDead   = player.state === 'dead';
    const isJump   = player.state === 'jumping' || player.state === 'falling';
    const isRun    = player.state === 'running';
    const isWall   = player.state === 'wall_sliding';
    const isDash   = player.state === 'dashing';

    // Body dimensions (nominal)
    const bw = player.width;   // 8
    const bh = 10;
    const cx = player.x + bw / 2;  // centre x for scaling pivot
    const cy = player.y + player.height / 2;

    ctx.save();

    // Apply squash/stretch around the player's centre
    ctx.translate(cx, cy);
    ctx.scale(player.scaleX, player.scaleY);
    ctx.translate(-cx, -cy);

    // ── Body + Head ───────────────────────────────────────────────────────
    const headRadius = 4;
    const headX = player.x + bw / 2;
    const headY = player.y + 2 - headRadius;  // approx player.y - 2

    const themeId: ThemeId = (state.spec?.theme?.tileset as ThemeId) ?? 'forest';
    const playerImg = this.getAsset(themeId, 'player');
    if (playerImg && !isDead) {
      // Sprite covers full body+head area; keep dynamic overlays (eyes, legs) on top
      ctx.drawImage(playerImg, player.x, player.y - headRadius, bw, bh + headRadius + 2);
    } else {
      // Procedural body
      ctx.fillStyle = isDead ? '#aa2222' : (isDash ? this.lighten(palette.player, 50) : palette.player);
      ctx.fillRect(player.x, player.y + 2, bw, bh);

      // Procedural head
      ctx.fillStyle = isDead ? '#bb3333' : this.lighten(palette.player, 20);
      ctx.beginPath();
      ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Eyes ──────────────────────────────────────────────────────────────
    if (!isDead) {
      ctx.fillStyle = '#ffffff';
      const eyeY = headY - 1;
      if (player.facing === 'right') {
        ctx.fillRect(player.x + 5, eyeY, 1.5, 1.5);
        ctx.fillRect(player.x + 7, eyeY, 1.5, 1.5);
      } else {
        ctx.fillRect(player.x + 1, eyeY, 1.5, 1.5);
        ctx.fillRect(player.x + 3, eyeY, 1.5, 1.5);
      }
    } else {
      // Dead eyes: draw X marks
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      const eyeY = headY - 1;
      // Left X
      const lx = player.facing === 'right' ? player.x + 5 : player.x + 1;
      ctx.beginPath(); ctx.moveTo(lx, eyeY); ctx.lineTo(lx + 1.5, eyeY + 1.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx + 1.5, eyeY); ctx.lineTo(lx, eyeY + 1.5); ctx.stroke();
      // Right X
      const rx = player.facing === 'right' ? player.x + 7 : player.x + 3;
      ctx.beginPath(); ctx.moveTo(rx, eyeY); ctx.lineTo(rx + 1.5, eyeY + 1.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx + 1.5, eyeY); ctx.lineTo(rx, eyeY + 1.5); ctx.stroke();
    }

    // ── Legs ──────────────────────────────────────────────────────────────
    const legColor = this.darken(palette.player, 20);
    ctx.fillStyle = legColor;

    const legY = player.y + 2 + bh;  // bottom of body

    if (isJump) {
      // Both legs together, angled slightly based on direction
      const legAngle = player.vy > 0 ? 2 : -2;
      ctx.fillRect(player.x + 1 + legAngle, legY, 2, 4);
      ctx.fillRect(player.x + 5 + legAngle, legY, 2, 4);
    } else if (isWall) {
      // Feet pressed into the wall
      const wallOffset = player.facing === 'right' ? 3 : -3;
      ctx.fillRect(player.x + 1 + wallOffset, legY, 2, 4);
      ctx.fillRect(player.x + 4 + wallOffset, legY, 2, 4);
    } else if (isRun) {
      // Alternate leg positions based on frame count for walk cycle
      const legPhase = Math.floor(fc / 5) % 2;
      ctx.fillRect(player.x + 1, legY - (legPhase === 0 ? 2 : 0), 2, 4);
      ctx.fillRect(player.x + 5, legY - (legPhase === 1 ? 2 : 0), 2, 4);
    } else {
      // Idle: legs down
      ctx.fillRect(player.x + 1, legY, 2, 4);
      ctx.fillRect(player.x + 5, legY, 2, 4);
    }

    // ── Landing dust puff (landing state) ─────────────────────────────────
    if (player.state === 'landing') {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(player.x - 2, legY + 3, 12, 2);
    }

    // ── Dash afterimage trail ─────────────────────────────────────────────
    if (isDash) {
      ctx.globalAlpha = 0.3;
      const trailOffset = player.facing === 'right' ? -6 : 6;
      ctx.fillStyle = palette.player;
      ctx.fillRect(player.x + trailOffset, player.y + 2, bw, bh);
      ctx.globalAlpha = 1;
    }

    // ── Melee sword arc ───────────────────────────────────────────────────
    const mt = (player as { meleeTimer?: number }).meleeTimer ?? 0;
    if (mt > 0) {
      const sx = player.facing === 'right' ? player.x + bw - 1 : player.x - 10;
      const sy = player.y + 4;
      ctx.strokeStyle = '#ddeeff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = Math.min(1, mt / 120);
      ctx.beginPath();
      ctx.moveTo(sx, sy + 8);
      ctx.lineTo(sx + (player.facing === 'right' ? 14 : -14), sy + 2);
      ctx.lineTo(sx + (player.facing === 'right' ? 10 : -10), sy - 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,220,255,0.35)';
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private drawBrightnessOverlay(ctx: CanvasRenderingContext2D, state: SharedState): void {
    const b = state.screenBrightness ?? 1;
    const W = this.nativeCanvas.width;
    const H = this.nativeCanvas.height;
    if (b < 0.995) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.85, 1 - b)})`;
      ctx.fillRect(0, 0, W, H);
    } else if (b > 1.005) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.45, (b - 1) * 0.9)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Entity drawing
  // ─────────────────────────────────────────────────────────────────────────

  private drawEntity(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    palette: ReturnType<typeof this.getPalette>,
    frameCount: number,
    themeId: ThemeId,
  ): void {
    const { x, y, archetype, animFrame, direction } = entity;

    switch (archetype) {

      // ── patrol: Goomba-style mushroom ─────────────────────────────────────
      case 'patrol': {
        const ew = 12;
        const eh = 8;
        const patrolImg = this.getAsset(themeId, 'enemy_patrol');
        if (patrolImg) {
          ctx.drawImage(patrolImg, x, y, ew, eh + 3);
        } else {
          const bob = Math.floor(frameCount / 6) % 2;
          const bx = x;
          const by = y + bob;
          ctx.fillStyle = this.darken(palette.enemy, 25);
          ctx.beginPath();
          ctx.ellipse(bx + ew / 2, by + eh - 2, ew / 2 - 1, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = palette.enemy;
          ctx.beginPath();
          ctx.ellipse(bx + ew / 2, by + 4, ew / 2, 5, 0, Math.PI, 0);
          ctx.fill();
          ctx.fillStyle = this.lighten(palette.enemy, 35);
          ctx.beginPath();
          ctx.ellipse(bx + ew / 2, by + 5, 4, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff7e6';
          const eyeX = direction === 1 ? bx + ew - 5 : bx + 2;
          ctx.fillRect(eyeX, by + 2, 2, 2);
          ctx.fillRect(eyeX + 3, by + 2, 2, 2);
          ctx.fillStyle = '#1a1020';
          ctx.fillRect(eyeX, by + 3, 1, 1);
          ctx.fillRect(eyeX + 3, by + 3, 1, 1);
        }
        break;
      }

      // ── boss: large multi-phase enemy ─────────────────────────────────────

      case 'boss': {
        const bw = entity.width;
        const bh = entity.height;
        const phase = (entity.params.bossPhase as number) ?? 1;

        // Body — colour shifts with phase
        const bodyColors = ['#cc4422', '#cc2244', '#ff2266'];
        ctx.fillStyle = bodyColors[phase - 1] ?? '#cc4422';
        ctx.fillRect(x, y, bw, bh);

        // Phase-indicator border
        ctx.strokeStyle = phase === 3 ? '#ff66aa' : phase === 2 ? '#ff4466' : '#cc4422';
        ctx.lineWidth   = phase;
        ctx.strokeRect(x, y, bw, bh);

        // Health bar
        const hpRatio = Math.max(0, Math.min(entity.health / 10, 1));
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x, y - 6, bw, 3);
        ctx.fillStyle = hpRatio > 0.5 ? '#44ff44' : hpRatio > 0.25 ? '#ffaa00' : '#ff4444';
        ctx.fillRect(x, y - 6, bw * hpRatio, 3);

        // Slam warning (flash during slamTimer)
        if ((entity.params.slamTimer as number) > 0) {
          ctx.fillStyle = 'rgba(255,200,0,0.3)';
          ctx.fillRect(x, y, bw, bh);
        }

        // Charge trail
        if ((entity.params.chargeTimer as number) > 0) {
          ctx.globalAlpha = 0.25;
          ctx.fillStyle   = '#ff4422';
          ctx.fillRect(x - entity.direction * 12, y + 4, bw, bh - 8);
          ctx.globalAlpha = 1;
        }

        // Eyes
        ctx.fillStyle = '#ffeeaa';
        ctx.fillRect(x + bw / 2 - 4, y + 6, 3, 3);
        ctx.fillRect(x + bw / 2 + 2, y + 6, 3, 3);
        break;
      }

      case 'projectile': {
        ctx.fillStyle = '#ff8844';
        ctx.beginPath();
        ctx.arc(x + entity.width / 2, y + entity.height / 2, 3, 0, Math.PI * 2);
        ctx.fill();

        const pvx = (entity.params.vx as number) ?? 0;
        const pvy = (entity.params.vy as number) ?? 0;
        ctx.strokeStyle = 'rgba(255,136,68,0.4)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(x + entity.width / 2, y + entity.height / 2);
        ctx.lineTo(x + entity.width / 2 - pvx * 3, y + entity.height / 2 - pvy * 3);
        ctx.stroke();
        break;
      }

      // ── chaser: eyeball that tracks the player ───────────────────────────
      case 'chaser': {
        const radius = 5;
        const cx = x + radius;
        const cy = y + radius;
        // Body circle
        ctx.fillStyle = palette.enemy;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        // Large tracking eye
        const eyeAngle = typeof entity.params.angle === 'number' ? entity.params.angle : 0;
        const eyeRadius = 3;
        const eyeX = cx + Math.cos(eyeAngle) * (radius - eyeRadius - 1);
        const eyeY = cy + Math.sin(eyeAngle) * (radius - eyeRadius - 1);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        // Pupil
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(eyeX + Math.cos(eyeAngle) * 1, eyeY + Math.sin(eyeAngle) * 1, 1.5, 0, Math.PI * 2);
        ctx.fill();
        // Intensity tint when close (entity.params.proximity 0→1)
        const proximity = typeof entity.params.proximity === 'number' ? entity.params.proximity : 0;
        if (proximity > 0.5) {
          ctx.fillStyle = `rgba(255,0,0,${(proximity - 0.5) * 0.6})`;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      // ── flyer: bat silhouette with flapping wings ─────────────────────────
      case 'flyer': {
        const bx = x + 3;
        const by = y + 2;
        const flyerImg = this.getAsset(themeId, 'enemy_flyer');
        if (flyerImg) {
          ctx.drawImage(flyerImg, x - 7, y, entity.width + 14, entity.height);
        } else {
        const flapOffset = Math.sin(frameCount * 0.25) * 3;

        // Left wing arc
        ctx.fillStyle = palette.enemy;
        ctx.beginPath();
        ctx.moveTo(bx, by + 2);
        ctx.quadraticCurveTo(bx - 6, by - 2 + flapOffset, bx - 10, by + flapOffset);
        ctx.quadraticCurveTo(bx - 6, by + 6,              bx,       by + 4);
        ctx.closePath();
        ctx.fill();

        // Right wing arc
        ctx.beginPath();
        ctx.moveTo(bx + 6, by + 2);
        ctx.quadraticCurveTo(bx + 12, by - 2 + flapOffset, bx + 16, by + flapOffset);
        ctx.quadraticCurveTo(bx + 12, by + 6,              bx + 6,  by + 4);
        ctx.closePath();
        ctx.fill();

        // Central body
        ctx.fillStyle = this.darken(palette.enemy, 15);
        ctx.fillRect(bx, by, 6, 4);

        // Dot eyes
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(bx + 1, by + 1, 1, 1);
        ctx.fillRect(bx + 4, by + 1, 1, 1);
        } // end else (no flyerImg)
        break;
      }

      // ── collectible / coin ────────────────────────────────────────────────
      case 'collectible':
      case 'coin': {
        const coinW = 6;
        const coinH = 6;
        const coinX = x + entity.width / 2;
        const coinY = y + entity.height / 2;
        const coinImg = this.getAsset(themeId, 'coin');

        if (coinImg) {
          const spinScale = Math.abs(Math.sin(frameCount * 0.08));
          ctx.save();
          ctx.translate(coinX, coinY);
          ctx.scale(spinScale, 1);
          ctx.translate(-coinX, -coinY);
          ctx.drawImage(coinImg, x, y, coinW, coinH);
          ctx.restore();
        } else {
          const spinScale = Math.abs(Math.sin(frameCount * 0.08));
          ctx.save();
          ctx.translate(coinX, coinY);
          ctx.scale(spinScale, 1);
          ctx.translate(-coinX, -coinY);

          // Coin body
          ctx.fillStyle = palette.coin;
          ctx.fillRect(x, y, coinW, coinH);
          // Highlight
          ctx.fillStyle = this.lighten(palette.coin, 40);
          ctx.fillRect(x + 1, y + 1, 2, 1);

          ctx.restore();
        }

        // Glow effect always applied
        ctx.fillStyle = `rgba(${this.hexToRgb(palette.coin)},0.15)`;
        ctx.fillRect(x - 2, y - 2, coinW + 4, coinH + 4);
        break;
      }

      // ── checkpoint: flag on a pole ────────────────────────────────────────
      case 'checkpoint': {
        const poleX = x + entity.width / 2;
        const poleH = 16;
        const poleY = y;

        // Pole
        ctx.fillStyle = '#aaaaaa';
        ctx.fillRect(poleX - 1, poleY, 2, poleH);

        // Flag (animated wave using sin)
        const waveTime = frameCount * 0.12;
        const flagW = 8;
        const flagH = 6;
        const flagY = poleY;
        const flagX = poleX + 1;

        ctx.fillStyle = entity.params.reached ? '#00ff88' : '#ffffff';
        ctx.beginPath();
        ctx.moveTo(flagX, flagY);
        for (let fx = 0; fx <= flagW; fx++) {
          const wave = Math.sin(waveTime + fx * 0.5) * 1.5;
          ctx.lineTo(flagX + fx, flagY + wave + (fx / flagW) * flagH * 0.5);
        }
        for (let fx = flagW; fx >= 0; fx--) {
          const wave = Math.sin(waveTime + fx * 0.5) * 1.5;
          ctx.lineTo(flagX + fx, flagY + wave + (fx / flagW) * flagH * 0.5 + flagH);
        }
        ctx.closePath();
        ctx.fill();

        // Base block
        ctx.fillStyle = '#888888';
        ctx.fillRect(poleX - 3, poleY + poleH, 6, 3);
        break;
      }

      // ── turret: stationary gun ────────────────────────────────────────────
      case 'turret': {
        const tw = entity.width;
        const th = entity.height;
        ctx.fillStyle = '#555566';
        ctx.fillRect(x, y, tw, th);
        // Barrel pointing in direction
        ctx.fillStyle = '#333344';
        const barrelX = direction === 1 ? x + tw : x - 4;
        ctx.fillRect(barrelX, y + th / 2 - 1, 4, 2);
        // Dot eye / sensor
        ctx.fillStyle = '#ff4400';
        ctx.beginPath();
        ctx.arc(x + tw / 2, y + th / 2, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      // ── NPC: friendly character ───────────────────────────────────────────
      case 'npc': {
        // Simple humanoid
        ctx.fillStyle = '#88aacc';
        ctx.fillRect(x, y, entity.width, entity.height);
        ctx.fillStyle = '#aaccee';
        ctx.beginPath();
        ctx.arc(x + entity.width / 2, y - 3, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      // ── default: generic coloured box ────────────────────────────────────
      default: {
        ctx.fillStyle = palette.enemy;
        ctx.fillRect(x, y, entity.width, entity.height);
        break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Particle drawing (screen-space: world coords projected through camera)
  // ─────────────────────────────────────────────────────────────────────────

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    particles: Particle[],
    camera: CameraLike,
  ): void {
    for (const p of particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      // Convert world-space particle position to screen space
      const sx = p.x - camera.x;
      const sy = p.y - camera.y;
      ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HUD / UI overlay (always screen-space)
  // ─────────────────────────────────────────────────────────────────────────

  private drawUI(
    ctx: CanvasRenderingContext2D,
    state: SharedState,
    player: PlayerLike,
    spec: GameSpec,
  ): void {
    const W = this.nativeCanvas.width;   // 320
    const H = this.nativeCanvas.height;  // 180

    // ── Health hearts (top-left) ──────────────────────────────────────────
    const maxHearts = state.maxHealth;
    const curHearts = state.health;
    for (let i = 0; i < maxHearts; i++) {
      const hx = 4 + i * 9;
      const hy = 4;
      const filled = i < curHearts;
      this.drawHeart(ctx, hx, hy, filled);
    }

    // ── Score (top-right) ─────────────────────────────────────────────────
    ctx.fillStyle = '#ffffff';
    ctx.font = '5px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(String(state.score).padStart(6, '0'), W - 4, 4);

    if (state.timeRemainingMs != null && state.timeRemainingMs > 0) {
      const sec = Math.ceil(state.timeRemainingMs / 1000);
      ctx.fillStyle = sec < 30 ? '#ff6666' : '#aaffcc';
      ctx.fillText(`${sec}s`, W - 4, 12);
    }

    // ── Phase badge / REC indicator (top-center) ──────────────────────────
    if (state.phase === 'voice_moment') {
      const recPulse = Math.sin(state.frameCount * 0.15) * 0.4 + 0.6;
      ctx.globalAlpha = recPulse;

      // Background pill
      ctx.fillStyle = '#220000';
      const pillW = 30;
      const pillH = 8;
      const pillX = W / 2 - pillW / 2;
      const pillY = 4;
      ctx.fillRect(pillX, pillY, pillW, pillH);

      // Red dot
      ctx.fillStyle = '#ff2222';
      ctx.beginPath();
      ctx.arc(pillX + 5, pillY + 4, 2, 0, Math.PI * 2);
      ctx.fill();

      // "REC" text
      ctx.fillStyle = '#ffdddd';
      ctx.font = '5px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('REC', pillX + 10, pillY + 4);

      ctx.globalAlpha = 1;
    }

    // ── Voice moment prompt (bottom-center) ───────────────────────────────
    if (state.phase === 'voice_moment') {
      const prompt = spec.voiceMoments?.[0]?.prompt ?? 'Speak now…';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, H - 18, W, 18);
      ctx.fillStyle = '#ffffff';
      ctx.font = '5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(prompt, W / 2, H - 9);
    }

    // Reset alignment for next frame
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** Draw a small pixel-art heart at (x, y). */
  private drawHeart(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    filled: boolean,
  ): void {
    // 6×6 pixel heart pattern
    ctx.fillStyle = filled ? '#ff4466' : '#442233';
    // Row 0: .XX.XX.
    ctx.fillRect(x + 1, y,     2, 1);
    ctx.fillRect(x + 4, y,     2, 1);
    // Row 1: XXXXXXX
    ctx.fillRect(x,     y + 1, 6, 1);
    // Row 2: XXXXXXX
    ctx.fillRect(x,     y + 2, 6, 1);
    // Row 3: .XXXXX.
    ctx.fillRect(x + 1, y + 3, 4, 1);
    // Row 4: ..XXX..
    ctx.fillRect(x + 2, y + 4, 2, 1);
    // Row 5: ...X...
    ctx.fillRect(x + 3, y + 5, 1, 1);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Loading screen (used before game init)
  // ─────────────────────────────────────────────────────────────────────────

  renderLoading(message: string, progress: number): void {
    const ctx = this.ctx;
    const W = this.nativeCanvas.width;
    const H = this.nativeCanvas.height;

    // Dark background
    ctx.fillStyle = '#060610';
    ctx.fillRect(0, 0, W, H);

    // Centred message text
    ctx.fillStyle = '#aaddff';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, W / 2, H / 2 - 10);

    // Progress bar track
    const barW  = 100;
    const barH  = 4;
    const barX  = W / 2 - barW / 2;
    const barY  = H / 2;
    ctx.fillStyle = '#222244';
    ctx.fillRect(barX, barY, barW, barH);

    // Progress bar fill
    const fillW = clamp(progress, 0, 1) * barW;
    ctx.fillStyle = '#44aaff';
    ctx.fillRect(barX, barY, fillW, barH);

    // Border
    ctx.strokeStyle = '#4466aa';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);

    // Percentage text
    ctx.fillStyle = '#88bbdd';
    ctx.font = '5px monospace';
    ctx.fillText(`${Math.round(progress * 100)}%`, W / 2, H / 2 + 10);

    // Scale up to display canvas
    this.displayCtx.drawImage(
      this.nativeCanvas,
      0, 0,
      this.displayCanvas.width,
      this.displayCanvas.height,
    );

    // Reset
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Colour helpers (operate on CSS hex strings like '#rrggbb')
  // ─────────────────────────────────────────────────────────────────────────

  /** Lighten a hex colour by `amount` (0–255). */
  private lighten(hex: string, amount: number): string {
    const [r, g, b] = this.hexParts(hex);
    return `rgb(${clamp(r + amount, 0, 255)},${clamp(g + amount, 0, 255)},${clamp(b + amount, 0, 255)})`;
  }

  /** Darken a hex colour by `amount` (0–255). */
  private darken(hex: string, amount: number): string {
    return this.lighten(hex, -amount);
  }

  /** Parse a '#rrggbb' hex string into [r, g, b] numbers. */
  private hexParts(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return [r, g, b];
  }

  /** Return 'r,g,b' string for use in rgba(). */
  private hexToRgb(hex: string): string {
    const [r, g, b] = this.hexParts(hex);
    return `${r},${g},${b}`;
  }

  /** Internal helper used as a type alias for palette objects. */
  private getPalette(themeId: ThemeId) {
    return THEME_PALETTES[themeId];
  }
}
