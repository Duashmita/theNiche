import { GameSpec, TileInfo, CollisionType, TileType } from '../types';

/**
 * Converts a GameSpec map into two runtime layers:
 *   visualTiles    – the raw tile-type number for the renderer
 *   collisionLayer – the CollisionType enum value used by physics
 *
 * Also manages runtime mutation (door opens, floor decay) and
 * one-shot trigger tracking.
 */
export class Tilemap {
  visualTiles: number[][] = [];      // [row][col]
  collisionLayer: CollisionType[][] = []; // [row][col]

  tileSize: number = 16;
  mapWidth: number = 0;   // in tiles
  mapHeight: number = 0;  // in tiles
  worldPixelWidth: number = 0;
  worldPixelHeight: number = 0;

  /** Set of 'col,row' keys for triggers that have already fired. */
  triggeredTiles: Set<string> = new Set();

  // ─── Initialisation ────────────────────────────────────────────────────────

  init(spec: GameSpec): void {
    this.tileSize      = spec.display.tileSize;
    this.mapWidth      = spec.map.width;
    this.mapHeight     = spec.map.height;
    this.worldPixelWidth  = this.mapWidth  * this.tileSize;
    this.worldPixelHeight = this.mapHeight * this.tileSize;

    this.triggeredTiles.clear();

    // Allocate and fill both layers from spec.map.tiles ([row][col])
    this.visualTiles    = [];
    this.collisionLayer = [];

    for (let row = 0; row < this.mapHeight; row++) {
      const srcRow = spec.map.tiles[row] ?? [];
      const visRow: number[]    = new Array(this.mapWidth).fill(TileType.AIR);
      const colRow: CollisionType[] = new Array(this.mapWidth).fill(CollisionType.NONE);

      for (let col = 0; col < this.mapWidth; col++) {
        const tile = srcRow[col] ?? TileType.AIR;
        visRow[col] = tile;
        colRow[col] = Tilemap.tileTypeToCollision(tile);
      }

      this.visualTiles.push(visRow);
      this.collisionLayer.push(colRow);
    }
  }

  // ─── Tile type → collision type mapping ───────────────────────────────────

  private static tileTypeToCollision(tile: number): CollisionType {
    switch (tile) {
      case TileType.AIR:        return CollisionType.NONE;
      case TileType.GROUND:     return CollisionType.SOLID;
      // Platforms use full AABB collision (same as ground) — no one-way pass-through.
      case TileType.PLATFORM:   return CollisionType.SOLID;
      case TileType.HAZARD:     return CollisionType.HAZARD;
      case TileType.DOOR:       return CollisionType.SOLID;
      case TileType.TRIGGER:    return CollisionType.TRIGGER;
      case TileType.DECORATION: return CollisionType.NONE;
      case TileType.LADDER:     return CollisionType.NONE;
      default:                  return CollisionType.NONE;
    }
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  /**
   * Returns all TileInfo objects whose pixel-space AABB overlaps the given
   * rectangle.  A 1-pixel inset is applied on each side to avoid spurious
   * triggers right on tile edges.
   *
   * Results are sorted with SOLID tiles first so that physics resolution
   * always handles the most constraining collision type first.
   */
  getTilesInRect(px: number, py: number, pw: number, ph: number): TileInfo[] {
    const ts = this.tileSize;

    // Apply 1-pixel inset to prevent false triggers at tile edges
    const inset = 1;
    const left   = px + inset;
    const top    = py + inset;
    const right  = px + pw - inset;
    const bottom = py + ph - inset;

    const colStart = Math.max(0, Math.floor(left   / ts));
    const colEnd   = Math.min(this.mapWidth  - 1, Math.floor(right  / ts));
    const rowStart = Math.max(0, Math.floor(top    / ts));
    const rowEnd   = Math.min(this.mapHeight - 1, Math.floor(bottom / ts));

    const results: TileInfo[] = [];

    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const tileType      = this.visualTiles[row]?.[col] ?? TileType.AIR;
        const collisionType = this.collisionLayer[row]?.[col] ?? CollisionType.NONE;

        // Skip pure air/decoration tiles — no need to return them
        if (collisionType === CollisionType.NONE) continue;

        results.push({
          col,
          row,
          pixelX: col * ts,
          pixelY: row * ts,
          collisionType,
          tileType,
        });
      }
    }

    // SOLID first, then PLATFORM, then HAZARD, then TRIGGER
    const order: Record<CollisionType, number> = {
      [CollisionType.SOLID]:    0,
      [CollisionType.PLATFORM]: 1,
      [CollisionType.HAZARD]:   2,
      [CollisionType.TRIGGER]:  3,
      [CollisionType.NONE]:     4,
    };

    results.sort((a, b) => order[a.collisionType] - order[b.collisionType]);

    return results;
  }

  /**
   * Returns the raw tile type at (col, row).  Out-of-bounds → 0 (AIR).
   */
  getTileAt(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.mapWidth || row >= this.mapHeight) {
      return TileType.AIR;
    }
    return this.visualTiles[row]?.[col] ?? TileType.AIR;
  }

  // ─── Mutation ─────────────────────────────────────────────────────────────

  /**
   * Set a tile's type at runtime (used by voice moments, floor decay, etc.).
   * Updates both visual and collision layers.
   */
  setTile(col: number, row: number, type: number): void {
    if (col < 0 || row < 0 || col >= this.mapWidth || row >= this.mapHeight) return;
    this.visualTiles[row][col]    = type;
    this.collisionLayer[row][col] = Tilemap.tileTypeToCollision(type);
  }

  /**
   * Open a door tile by replacing it with AIR.
   * The actual visual "door open" animation is handled by the renderer
   * reading `visualTiles`; once this is called the tile becomes passable
   * on the very next physics frame.
   */
  openDoor(col: number, row: number): void {
    this.setTile(col, row, TileType.AIR);
  }

  // ─── Trigger tracking ─────────────────────────────────────────────────────

  /** Returns true if the trigger at (col, row) has already fired. */
  isTriggerFired(col: number, row: number): boolean {
    return this.triggeredTiles.has(`${col},${row}`);
  }

  /** Mark the trigger at (col, row) as fired so it only activates once. */
  fireTrigger(col: number, row: number): void {
    this.triggeredTiles.add(`${col},${row}`);
  }
}
