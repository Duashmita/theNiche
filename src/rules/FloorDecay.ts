import { EventBus } from '../engine/EventBus';
import { RuleSpec, SharedState } from '../types';
import { Rule } from './GravityFlip';

export class FloorDecayRule implements Rule {
  readonly id = 'floor_decay';

  // Map of 'col,row' → timestamp when player landed on that tile
  private touched: Map<string, number> = new Map();
  private delayMs = 800;

  // We need tilemap access — store a reference set during init
  private tilemap: { setTile: (col: number, row: number, type: number) => void } | null = null;

  init(spec: RuleSpec, events: EventBus): void {
    this.delayMs = typeof spec.params.delay_ms === 'number' ? spec.params.delay_ms : 800;
    this.touched.clear();

    // IMPORTANT: player_landed event includes tileX and tileY (PhysicsSystem guarantees this)
    events.on('player_landed', (data: { tileX?: number; tileY?: number }) => {
      if (typeof data?.tileX !== 'number' || typeof data?.tileY !== 'number') return;
      const key = `${data.tileX},${data.tileY}`;
      if (!this.touched.has(key)) {
        this.touched.set(key, performance.now());
      }
    });
  }

  setTilemap(tilemap: { setTile: (col: number, row: number, type: number) => void }): void {
    this.tilemap = tilemap;
  }

  update(_state: SharedState, _dt: number): void {
    if (!this.tilemap) return;
    const now = performance.now();

    for (const [key, timestamp] of this.touched) {
      if (now - timestamp > this.delayMs) {
        const [col, row] = key.split(',').map(Number);
        this.tilemap.setTile(col, row, 0);  // remove tile (AIR)
        this.touched.delete(key);
        // Renderer picks up the visual change automatically via visualTiles
      }
    }
  }
}
