import { clamp, lerp } from '../utils/math';

/**
 * Minimal interface for the PlayerController properties the camera needs.
 * The real PlayerController will satisfy this when it is written.
 */
interface CameraTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  facing: 'left' | 'right';
}

/**
 * Smooth-follow camera with directional look-ahead and world-bound clamping.
 *
 * Coordinate system: camera.x / camera.y is the world-space position of the
 * TOP-LEFT corner of the viewport.  The renderer uses ctx.translate(-camera.x,
 * -camera.y) to move the world into screen space.
 */
export class Camera {
  /** Current world-space position of the viewport top-left corner. */
  x: number = 0;
  y: number = 0;

  /** Native (un-scaled) viewport dimensions. */
  readonly screenWidth:  number = 320;
  readonly screenHeight: number = 180;

  // ─── Tuning constants ─────────────────────────────────────────────────────

  /** Lerp factor per frame — lower = smoother but more lag. */
  private readonly LERP:            number = 0.10;

  /**
   * How many pixels the target shifts ahead of the player in their
   * movement direction.  Creates a subtle "peeking" effect.
   */
  private readonly LOOK_AHEAD:      number = 64;

  /**
   * Vertical offset (negative = up) so the player sits in the lower
   * half of the screen and can see more of what is above them.
   */
  private readonly VERTICAL_OFFSET: number = -30;

  // ─── Per-frame update ────────────────────────────────────────────────────

  /**
   * Move the camera toward the player, respecting world bounds.
   *
   * @param player  Any object with x, y, width, height, facing.
   * @param worldW  World pixel width  (tilemap.worldPixelWidth).
   * @param worldH  World pixel height (tilemap.worldPixelHeight).
   */
  update(player: CameraTarget, worldW: number, worldH: number): void {
    const lookAhead = player.facing === 'right' ? this.LOOK_AHEAD : -this.LOOK_AHEAD;

    // Desired viewport top-left so the player's centre is centred + look-ahead
    const targetX =
      player.x + player.width  / 2 + lookAhead      - this.screenWidth  / 2;
    const targetY =
      player.y + player.height / 2 + this.VERTICAL_OFFSET - this.screenHeight / 2;

    // Smooth interpolation toward target
    this.x = lerp(this.x, targetX, this.LERP);
    this.y = lerp(this.y, targetY, this.LERP);

    // Clamp so the viewport never shows beyond the world edges
    this.x = clamp(this.x, 0, Math.max(0, worldW - this.screenWidth));
    this.y = clamp(this.y, 0, Math.max(0, worldH - this.screenHeight));
  }

  // ─── Coordinate conversion ────────────────────────────────────────────────

  /**
   * Convert a world-space point to screen-space pixel coordinates.
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX - this.x,
      y: worldY - this.y,
    };
  }

  // ─── Visibility / frustum culling ─────────────────────────────────────────

  /**
   * Returns true when the AABB (px, py, pw, ph) in world space is at least
   * partially visible within the camera viewport (with a 32 px margin so that
   * objects just outside the frame are still drawn and don't pop in).
   */
  isVisible(px: number, py: number, pw: number, ph: number): boolean {
    const margin = 32;
    return (
      px + pw >= this.x - margin &&
      px      <= this.x + this.screenWidth  + margin &&
      py + ph >= this.y - margin &&
      py      <= this.y + this.screenHeight + margin
    );
  }
}
