import { PlayerController } from './PlayerController';
import { Tilemap } from './Tilemap';
import { EventBus } from './EventBus';
import { SharedState, CollisionType } from '../types';

export class PhysicsSystem {
  update(
    player: PlayerController,
    tilemap: Tilemap,
    events: EventBus,
    state: SharedState,
  ): void {
    if (!player.alive) return;

    // Reset per-frame contact flags
    player.onGround = false;
    player.wallTouchLeft = false;
    player.wallTouchRight = false;

    // ===== STEP 1: X axis =================================================
    player.x += player.vx;

    const tilesX = tilemap.getTilesInRect(player.x, player.y, player.width, player.height);
    for (const tile of tilesX) {
      // ── Solid collision ──────────────────────────────────────────────────
      if (tile.collisionType === CollisionType.SOLID) {
        if (player.vx > 0) {
          // Moving right — push back to left face of tile
          player.x = tile.pixelX - player.width;
          player.wallTouchRight = true;
        } else if (player.vx < 0) {
          // Moving left — push back to right face of tile
          player.x = tile.pixelX + tilemap.tileSize;
          player.wallTouchLeft = true;
        }
        player.vx = 0;
      }

      // ── Trigger tiles ────────────────────────────────────────────────────
      if (tile.collisionType === CollisionType.TRIGGER) {
        const tileKey = `${tile.col},${tile.row}`;
        if (!tilemap.isTriggerFired(tile.col, tile.row)) {
          tilemap.fireTrigger(tile.col, tile.row);
          events.emit('player_entered_trigger', {
            tileKey,
            tileX: tile.col,
            tileY: tile.row,
          });
        }
      }
    }

    // ===== STEP 2: Y axis =================================================
    player.y += player.vy;

    const tilesY = tilemap.getTilesInRect(player.x, player.y, player.width, player.height);
    for (const tile of tilesY) {
      // ── Solid collision ──────────────────────────────────────────────────
      if (tile.collisionType === CollisionType.SOLID) {
        if (player.vy > 0) {
          // Falling down — land on top of tile
          player.y = tile.pixelY - player.height;
          const wasAirborne = !player.onGround;
          player.onGround = true;
          // Capture vy before zeroing for the event payload
          const landingVy = player.vy;
          player.vy = 0;
          if (wasAirborne) {
            events.emit('player_landed', {
              vy: landingVy,
              tileX: tile.col,
              tileY: tile.row,
            });
          }
        } else if (player.vy < 0) {
          // Moving up — hit ceiling
          player.y = tile.pixelY + tilemap.tileSize;
          player.vy = 0;
          events.emit('player_hit_ceiling', {});
        }
      }

      // ── Hazard — deal damage ─────────────────────────────────────────────
      if (tile.collisionType === CollisionType.HAZARD) {
        events.emit('player_hit_hazard', {});
        player.takeDamage(events, state);
      }

      // ── Trigger tiles (Y axis pass) ──────────────────────────────────────
      if (tile.collisionType === CollisionType.TRIGGER) {
        const tileKey = `${tile.col},${tile.row}`;
        if (!tilemap.isTriggerFired(tile.col, tile.row)) {
          tilemap.fireTrigger(tile.col, tile.row);
          events.emit('player_entered_trigger', {
            tileKey,
            tileX: tile.col,
            tileY: tile.row,
          });
        }
      }
    }

    // ── Gravity-flipped "ceiling is ground" note ────────────────────────────
    // When gravity < 0 the JUMP_FORCE pushes vy positive (downward in screen
    // space = upward relative to flipped gravity).  The solid-ceiling branch
    // above already snaps the player to tile bottom and zeroes vy, but it does
    // NOT set onGround because the player is moving *up* in screen space.
    // Instead, PlayerController's jump logic uses Math.sign(gravity) so the
    // force is always in the correct direction.  The ceiling branch can be
    // augmented here if a full "floor is ceiling" mode is needed.
  }
}
