import {
  GenerationParams,
  GameSpec,
  MapSection,
  EntitySpec,
  VoiceMomentSpec,
  TileType,
  THEME_PALETTES,
  RuleId,
} from '../types';

function defaultRuleParams(id: RuleId): Record<string, unknown> {
  switch (id) {
    case 'time_limit':
      return { seconds: 180 };
    case 'wind':
      return { strength: 0.16 };
    case 'speed_boost':
      return { mult: 1.22 };
    case 'vision_limit':
    case 'darkness':
      return { brightness: 0.7 };
    default:
      return {};
  }
}

// ─── Internal room graph types (not part of GameSpec) ─────────────────────────

interface RoomNode {
  id: number;
  gridCol: number;   // position in the room grid (not tile coords)
  gridRow: number;
  tileX: number;     // top-left tile coordinate in the full map
  tileY: number;
  widthTiles: number;
  heightTiles: number;
  section: MapSection;
  connections: number[];  // ids of adjacent connected rooms
}

interface RoomConnection {
  from: number;
  to: number;
  axis: 'horizontal' | 'vertical';
}

// ─── ProceduralGenerator ─────────────────────────────────────────────────────
//
// Layout strategies:
//   linear  — unchanged: sections along the X axis (the original implementation)
//   rooms   — a 2D grid of enclosed rooms connected by passages and ladders
//   arena   — a single enclosed space with tiered platforms and wave spawns
//
// All three produce the same GameSpec shape. Nothing downstream changes.

export class ProceduralGenerator {
  private readonly TILE_SIZE    = 16;
  private readonly MAP_HEIGHT   = 30;
  private readonly GROUND_ROW   = 23;   // used only in linear mode

  // ─── Public entry point ────────────────────────────────────────────────────

  generate(params: GenerationParams): GameSpec {
    let grid: number[][];
    let width: number;
    let height: number;
    let entities: EntitySpec[];
    let voiceMoments: VoiceMomentSpec[];
    let spawnPoint: { x: number; y: number };
    let exitPoint:  { x: number; y: number };

    switch (params.layout) {
      case 'rooms': {
        const result = this.buildRooms(params);
        grid         = result.grid;
        width        = result.width;
        height       = result.height;
        entities     = result.entities;
        spawnPoint   = result.spawnPoint;
        exitPoint    = result.exitPoint;
        voiceMoments = this.placeVoiceMomentsRooms(params, result.rooms, grid, width, height);
        break;
      }
      case 'arena': {
        const result = this.buildArena(params);
        grid         = result.grid;
        width        = result.width;
        height       = result.height;
        entities     = result.entities;
        spawnPoint   = result.spawnPoint;
        exitPoint    = result.exitPoint;
        voiceMoments = this.placeVoiceMomentsArena(params, grid, width, height);
        break;
      }
      default: {
        // 'linear' — original implementation
        const result = this.buildLinear(params);
        grid         = result.grid;
        width        = result.width;
        height       = this.MAP_HEIGHT;
        entities     = this.placeEntitiesLinear(params, width);
        spawnPoint   = { x: 3, y: this.GROUND_ROW - 2 };
        exitPoint    = { x: width - 4, y: this.GROUND_ROW - 2 };
        voiceMoments = this.placeVoiceMomentsLinear(params, grid, width);
        break;
      }
    }

    const palette = THEME_PALETTES[params.theme];

    return {
      meta: {
        name:        params.title,
        description: params.description,
        difficulty:  params.difficulty,
        gameSpeed:   params.gameSpeed ?? 1,
      },
      display: {
        nativeWidth:  320,
        nativeHeight: 180,
        tileSize:     this.TILE_SIZE,
        renderScale:  3,
      },
      map: {
        width,
        height,
        layout:     params.layout,
        tiles:      grid,
        spawnPoint,
        exitPoint,
      },
      theme: {
        tileset:          params.theme,
        palette:          params.palette.length > 0
          ? params.palette
          : [palette.ground, palette.groundTop, palette.platform, palette.hazard],
        backgroundColor:  params.backgroundColor || palette.bg,
        music:            `${params.theme}_ambient`,
        sfxSet:           params.theme,
        parallaxLayers:   [],
      },
      player: {
        sprite:    'player',
        abilities: params.abilities,
        health:    params.startingHealth ?? 3,
      },
      entities,
      rules:        params.rules.map((id) => ({
        id,
        params: {
          ...defaultRuleParams(id),
          ...(id === 'gravity_flip' && params.gravityStartsInverted ? { startInverted: true } : {}),
        },
      })),
      voiceMoments,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LINEAR LAYOUT  (original — refactored into a named method)
  // ═══════════════════════════════════════════════════════════════════════════

  private buildLinear(params: GenerationParams): { grid: number[][]; width: number } {
    const sectionTotalWidth = params.sections.reduce((s, sec) => s + sec.widthTiles, 0);
    const totalWidth = 8 + sectionTotalWidth + 8;

    const grid: number[][] = Array.from(
      { length: this.MAP_HEIGHT },
      () => new Array(totalWidth).fill(TileType.AIR),
    );

    // Solid ground
    for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++)
      for (let col = 0; col < totalWidth; col++)
        grid[row][col] = TileType.GROUND;

    // Border walls
    for (let row = 0; row < this.MAP_HEIGHT; row++) {
      grid[row][0] = TileType.GROUND; grid[row][1] = TileType.GROUND;
      grid[row][totalWidth - 1] = TileType.GROUND; grid[row][totalWidth - 2] = TileType.GROUND;
    }

    let cursor = 8;
    for (const section of params.sections) {
      this.buildLinearSection(grid, section, cursor, totalWidth, params.difficulty);
      cursor += section.widthTiles;
    }

    // Clear spawn area
    for (let row = this.GROUND_ROW - 5; row < this.GROUND_ROW; row++)
      for (let col = 2; col <= 7; col++)
        grid[row][col] = TileType.AIR;

    // Clear exit area
    for (let row = this.GROUND_ROW - 5; row < this.GROUND_ROW; row++)
      for (let col = totalWidth - 8; col < totalWidth - 2; col++)
        if (col >= 0 && col < totalWidth) grid[row][col] = TileType.AIR;

    this.ensureGapBridges(grid, totalWidth, this.GROUND_ROW, this.MAP_HEIGHT);

    return { grid, width: totalWidth };
  }

  private buildLinearSection(
    grid: number[][], section: MapSection, startCol: number,
    totalWidth: number, difficulty: number,
  ): void {
    const endCol = startCol + section.widthTiles;

    switch (section.type) {
      case 'intro': {
        if (section.widthTiles > 18) {
          const gapCenter = Math.floor(startCol + section.widthTiles * 0.6);
          const gapWidth  = Math.min(2 + (difficulty > 0.5 ? 1 : 0), 3);
          const gapStart  = gapCenter - Math.floor(gapWidth / 2);
          if (gapStart + gapWidth < endCol - 2 && gapStart > startCol + 2) {
            for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++)
              for (let col = gapStart; col < gapStart + gapWidth; col++)
                grid[row][col] = TileType.AIR;
            const platRow = this.GROUND_ROW - 3;
            for (let col = gapStart - 1; col <= gapStart + gapWidth; col++)
              if (col >= 0 && col < totalWidth) grid[platRow][col] = TileType.PLATFORM;
          }
        }
        break;
      }
      case 'challenge': {
        const numGaps = Math.min(1 + Math.floor(difficulty * 2.5), 3);
        const spaceBetween = Math.floor((section.widthTiles - 4) / (numGaps + 1));
        for (let i = 0; i < numGaps; i++) {
          const gapStart = startCol + 2 + spaceBetween * (i + 1);
          const gapWidth = Math.min(2 + Math.floor(section.hazardDensity * 2), 4);
          if (gapStart + gapWidth >= endCol - 2) continue;
          for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++)
            for (let col = gapStart; col < gapStart + gapWidth; col++)
              grid[row][col] = TileType.AIR;
          if (section.hazardDensity > 0.4)
            for (let col = gapStart; col < gapStart + gapWidth; col++)
              grid[this.GROUND_ROW][col] = TileType.HAZARD;
          const platHeight = Math.round(2 + difficulty * 2);
          const platRow = Math.min(
            Math.max(this.GROUND_ROW - platHeight, this.GROUND_ROW - 4),
            this.GROUND_ROW - 2,
          );
          for (let col = gapStart - 1; col <= gapStart + gapWidth; col++)
            if (col >= 0 && col < totalWidth) grid[platRow][col] = TileType.PLATFORM;
        }
        break;
      }
      case 'checkpoint': break;
      case 'finale': {
        const gapOffset = Math.floor(section.widthTiles * 0.35);
        const gapStart  = startCol + gapOffset;
        const gapWidth  = 3;
        if (gapStart + gapWidth < endCol - 2) {
          for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++)
            for (let col = gapStart; col < gapStart + gapWidth; col++)
              grid[row][col] = TileType.AIR;
          for (let col = gapStart; col < gapStart + gapWidth; col++)
            grid[this.GROUND_ROW][col] = TileType.HAZARD;
          const platRow = this.GROUND_ROW - 3;
          for (let col = gapStart - 1; col <= gapStart + gapWidth; col++)
            if (col >= 0 && col < totalWidth) grid[platRow][col] = TileType.PLATFORM;
        }
        const trigRow = this.GROUND_ROW - 1;
        const trigCol = startCol + 3;
        if (trigCol < endCol - 2 && trigRow >= 0) grid[trigRow][trigCol] = TileType.TRIGGER;
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROOMS LAYOUT
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Strategy:
  //   1. Determine grid dimensions from section count and widths.
  //   2. Assign each section to a room node at (gridCol, gridRow).
  //   3. Build a minimum spanning tree so every room is reachable.
  //   4. Write room tiles (floor, walls, ceiling, interior hazards/platforms).
  //   5. Write passage tiles (horizontal corridors or vertical ladder shafts).
  //   6. Place entities per-room.
  //   7. Spawn and exit points derived from intro/finale rooms.

  private buildRooms(params: GenerationParams): {
    grid: number[][];
    width: number;
    height: number;
    entities: EntitySpec[];
    rooms: RoomNode[];
    spawnPoint: { x: number; y: number };
    exitPoint: { x: number; y: number };
  } {
    // ── Step 1: decide grid dimensions ──────────────────────────────────────
    //
    // We lay out rooms in a 2D grid.  Section count determines columns;
    // we use 2 rows to create vertical exploration opportunities.
    // Odd-indexed sections go on row 0, even go on row 1 (except intro/finale
    // which are always placed on row 1 for clear path clarity).

    const ROOM_COLS   = Math.max(2, Math.ceil(params.sections.length / 2));
    const ROOM_ROWS   = 2;
    // Each room is ROOM_W × ROOM_H tiles (interior); walls add 1 tile each side.
    const ROOM_INNER_W = 22;
    const ROOM_INNER_H = 11;
    const WALL         = 1;   // wall thickness in tiles
    const ROOM_TOTAL_W = ROOM_INNER_W + WALL * 2;
    const ROOM_TOTAL_H = ROOM_INNER_H + WALL * 2;
    // Passage openings between rooms
    const PASSAGE_W    = 4;   // width of horizontal corridor in tiles (height)
    const PASSAGE_LEN  = 3;   // tile length of connecting passage

    const totalWidth  = ROOM_COLS * ROOM_TOTAL_W + (ROOM_COLS - 1) * PASSAGE_LEN + 2;
    const totalHeight = ROOM_ROWS * ROOM_TOTAL_H + PASSAGE_LEN + 2;

    // ── Step 2: build room nodes ─────────────────────────────────────────────
    const rooms: RoomNode[] = [];
    const sectionsCopy = [...params.sections];

    // Ensure intro is first, finale is last
    const introIdx  = sectionsCopy.findIndex(s => s.type === 'intro');
    const finaleIdx = sectionsCopy.findIndex(s => s.type === 'finale');
    if (introIdx > 0)  { const [s] = sectionsCopy.splice(introIdx, 1);  sectionsCopy.unshift(s); }
    if (finaleIdx >= 0 && finaleIdx !== sectionsCopy.length - 1) {
      const [s] = sectionsCopy.splice(
        sectionsCopy.findIndex(s => s.type === 'finale'), 1,
      );
      sectionsCopy.push(s);
    }

    // Assign sections to grid positions in a snake pattern:
    // row 1: col 0,1,2...   row 0: col (last)...(first)
    // This creates a natural left→right→up→right path.
    const gridPositions: Array<{gc: number; gr: number}> = [];
    for (let c = 0; c < ROOM_COLS; c++) gridPositions.push({ gc: c, gr: 1 });
    for (let c = ROOM_COLS - 1; c >= 0; c--) gridPositions.push({ gc: c, gr: 0 });

    for (let i = 0; i < sectionsCopy.length && i < ROOM_COLS * ROOM_ROWS; i++) {
      const { gc, gr } = gridPositions[i];
      const tileX = 1 + gc * (ROOM_TOTAL_W + PASSAGE_LEN);
      const tileY = 1 + gr * (ROOM_TOTAL_H + PASSAGE_LEN);
      rooms.push({
        id: i,
        gridCol: gc,
        gridRow: gr,
        tileX,
        tileY,
        widthTiles:  ROOM_TOTAL_W,
        heightTiles: ROOM_TOTAL_H,
        section: sectionsCopy[i],
        connections: [],
      });
    }

    // ── Step 3: MST to ensure full connectivity ──────────────────────────────
    // Use a simple Prim-style pass — prefer adjacent grid neighbours.
    const connections: RoomConnection[] = [];
    const visited = new Set<number>([0]);
    const roomsByGrid = new Map<string, RoomNode>();
    for (const r of rooms) roomsByGrid.set(`${r.gridCol},${r.gridRow}`, r);

    while (visited.size < rooms.length) {
      // Find an unvisited room adjacent to any visited room
      let added = false;
      for (const id of Array.from(visited)) {
        const r = rooms[id];
        // Check four neighbours
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const neighbour = roomsByGrid.get(`${r.gridCol+dc},${r.gridRow+dr}`);
          if (!neighbour || visited.has(neighbour.id)) continue;
          visited.add(neighbour.id);
          const axis: 'horizontal' | 'vertical' = dc !== 0 ? 'horizontal' : 'vertical';
          connections.push({ from: r.id, to: neighbour.id, axis });
          r.connections.push(neighbour.id);
          neighbour.connections.push(r.id);
          added = true;
          break;
        }
        if (added) break;
      }
      if (!added) break; // guard against disconnected grid (shouldn't happen)
    }

    // Optionally add a few extra connections for loops (makes exploration richer)
    for (const r of rooms) {
      const rightNeighbour = roomsByGrid.get(`${r.gridCol+1},${r.gridRow}`);
      if (rightNeighbour && !r.connections.includes(rightNeighbour.id) && Math.random() < 0.4) {
        connections.push({ from: r.id, to: rightNeighbour.id, axis: 'horizontal' });
        r.connections.push(rightNeighbour.id);
        rightNeighbour.connections.push(r.id);
      }
    }

    // ── Step 4: write tiles ──────────────────────────────────────────────────
    const grid: number[][] = Array.from(
      { length: totalHeight },
      () => new Array(totalWidth).fill(TileType.GROUND),   // start with all solid
    );

    // Carve out each room interior
    for (const room of rooms) {
      this.carveRoom(grid, room, params.difficulty);
    }

    // Carve passages between connected rooms
    for (const conn of connections) {
      const a = rooms[conn.from];
      const b = rooms[conn.to];
      this.carvePassage(grid, a, b, conn.axis, WALL, PASSAGE_W, PASSAGE_LEN, totalWidth, totalHeight);
    }

    // ── Step 5: place entities ───────────────────────────────────────────────
    const entities = this.placeEntitiesRooms(params, rooms);

    // ── Step 6: spawn and exit ───────────────────────────────────────────────
    const introRoom  = rooms[0];
    const finaleRoom = rooms[rooms.length - 1];

    const spawnPoint = {
      x: introRoom.tileX + WALL + 2,
      y: introRoom.tileY + ROOM_INNER_H - 1,   // one tile above the floor
    };
    const exitPoint = {
      x: finaleRoom.tileX + ROOM_INNER_W - 2,
      y: finaleRoom.tileY + ROOM_INNER_H - 1,
    };

    return { grid, width: totalWidth, height: totalHeight, entities, rooms, spawnPoint, exitPoint };
  }

  // ── Carve a single room into the grid ─────────────────────────────────────
  private carveRoom(grid: number[][], room: RoomNode, difficulty: number): void {
    const { tileX, tileY, widthTiles, heightTiles, section } = room;
    const WALL = 1;
    const innerX = tileX + WALL;
    const innerY = tileY + WALL;
    const innerW = widthTiles  - WALL * 2;
    const innerH = heightTiles - WALL * 2;

    // Hollow out the interior to AIR
    for (let row = innerY; row < innerY + innerH; row++)
      for (let col = innerX; col < innerX + innerW; col++)
        this.setGrid(grid, col, row, TileType.AIR);

    // Floor (solid ground along the bottom of the room)
    for (let col = innerX; col < innerX + innerW; col++)
      this.setGrid(grid, col, innerY + innerH - 1, TileType.GROUND);

    // ── Interior features by section type ──
    switch (section.type) {
      case 'intro': {
        // A single low platform in the middle to teach jumping
        const platRow = innerY + innerH - 4;
        const platMid = innerX + Math.floor(innerW / 2);
        for (let c = platMid - 3; c <= platMid + 3; c++)
          this.setGrid(grid, c, platRow, TileType.PLATFORM);
        // Coin above it
        break;
      }

      case 'challenge': {
        // 1-3 platforms at varying heights, hazard pit in the middle if dense
        const numPlatforms = 1 + Math.floor(section.hazardDensity * 2.5);
        for (let i = 0; i < numPlatforms; i++) {
          const platRow = innerY + innerH - 3 - i * 3;
          const platX   = innerX + 2 + Math.floor((innerW - 8) * (i / numPlatforms));
          if (platRow > innerY + 1)
            for (let c = platX; c < platX + 6; c++)
              this.setGrid(grid, c, platRow, TileType.PLATFORM);
        }

        // Hazard pit across part of the floor
        if (section.hazardDensity > 0.5) {
          const pitStart = innerX + Math.floor(innerW * 0.3);
          const pitEnd   = innerX + Math.floor(innerW * 0.6);
          for (let c = pitStart; c <= pitEnd; c++)
            this.setGrid(grid, c, innerY + innerH - 1, TileType.HAZARD);
        }
        break;
      }

      case 'checkpoint': {
        // Clean floor, a tall platform in the middle for the checkpoint entity
        const platRow = innerY + innerH - 4;
        const platMid = innerX + Math.floor(innerW / 2);
        for (let c = platMid - 2; c <= platMid + 2; c++)
          this.setGrid(grid, c, platRow, TileType.PLATFORM);
        break;
      }

      case 'finale': {
        // Layered platforms forcing vertical traversal + a trigger tile
        const layers = [innerH - 3, innerH - 6, innerH - 9];
        for (const [i, offset] of layers.entries()) {
          const row  = innerY + offset;
          const side = i % 2 === 0 ? 0 : Math.floor(innerW / 2);
          if (row > innerY + 1)
            for (let c = innerX + side + 1; c < innerX + side + Math.floor(innerW / 2) - 1; c++)
              this.setGrid(grid, c, row, TileType.PLATFORM);
        }
        // Trigger tile near room entrance (bottom-left)
        this.setGrid(grid, innerX + 2, innerY + innerH - 2, TileType.TRIGGER);

        // Hazard floor under the whole room except near the entrance
        if (difficulty > 0.5)
          for (let c = innerX + 5; c < innerX + innerW - 2; c++)
            this.setGrid(grid, c, innerY + innerH - 1, TileType.HAZARD);

        // Door at the far wall
        for (let r = innerY + innerH - 4; r <= innerY + innerH - 1; r++) {
          this.setGrid(grid, innerX + innerW - 2, r, TileType.DOOR);
          this.setGrid(grid, innerX + innerW - 1, r, TileType.DOOR);
        }
        break;
      }
    }
  }

  // ── Carve a passage between two adjacent rooms ────────────────────────────
  private carvePassage(
    grid: number[][],
    a: RoomNode, b: RoomNode,
    axis: 'horizontal' | 'vertical',
    wall: number,
    passageW: number,
    passageLen: number,
    totalWidth: number,
    totalHeight: number,
  ): void {
    if (axis === 'horizontal') {
      // Which room is on the left?
      const left  = a.tileX < b.tileX ? a : b;
      const right = a.tileX < b.tileX ? b : a;

      // Opening position: centred vertically in the room, near the floor
      const openingRow = left.tileY + left.heightTiles - wall - Math.floor(passageW / 2) - 2;
      const startCol   = left.tileX  + left.widthTiles;       // right wall of left room
      const endCol     = right.tileX;                          // left wall of right room

      for (let col = startCol; col < endCol; col++)
        for (let r = openingRow; r < openingRow + passageW; r++)
          this.setGrid(grid, col, r, TileType.AIR);

      // Floor in passage
      for (let col = startCol; col < endCol; col++)
        this.setGrid(grid, col, openingRow + passageW - 1, TileType.GROUND);

      // Punch matching openings in the walls
      for (let r = openingRow; r < openingRow + passageW - 1; r++) {
        this.setGrid(grid, startCol - 1, r, TileType.AIR);
        this.setGrid(grid, endCol,       r, TileType.AIR);
      }
    } else {
      // Vertical passage — ladder shaft
      const top    = a.tileY < b.tileY ? a : b;
      const bottom = a.tileY < b.tileY ? b : a;

      // Shaft in the middle-right of the rooms
      const shaftCol  = top.tileX + Math.floor(top.widthTiles * 0.65);
      const startRow  = top.tileY  + top.heightTiles;   // floor of top room
      const endRow    = bottom.tileY;                    // ceiling of bottom room

      for (let row = startRow; row < endRow; row++)
        for (let c = shaftCol; c < shaftCol + 3; c++)
          this.setGrid(grid, c, row, TileType.LADDER);

      // Open holes in the ceilings/floors
      for (let c = shaftCol; c < shaftCol + 3; c++) {
        this.setGrid(grid, c, startRow - 1, TileType.AIR);  // top room floor
        this.setGrid(grid, c, endRow,       TileType.AIR);  // bottom room ceiling
      }
    }
  }

  // ── Entity placement for rooms ─────────────────────────────────────────────
  private placeEntitiesRooms(params: GenerationParams, rooms: RoomNode[]): EntitySpec[] {
    const entities: EntitySpec[] = [];
    let idCounter = 0;
    const nextId = (prefix: string) => `${prefix}_${++idCounter}`;
    const WALL = 1;

    for (const room of rooms) {
      const { tileX, tileY, widthTiles, heightTiles, section } = room;
      const innerX  = tileX + WALL;
      const innerY  = tileY + WALL;
      const innerW  = widthTiles  - WALL * 2;
      const innerH  = heightTiles - WALL * 2;
      const floorRow = innerY + innerH - 2;   // one tile above floor solid
      const midX     = innerX + Math.floor(innerW / 2);

      switch (section.type) {
        case 'intro': {
          // Three coins forming a trail
          for (let i = 0; i < 3; i++)
            entities.push({
              id: nextId('coin'), type: 'collectible', archetype: 'coin',
              x: innerX + 3 + i * 3, y: floorRow - 2, params: {},
            });
          break;
        }

        case 'challenge': {
          const spacing = Math.floor(innerW / (section.enemyCount + 1));
          for (let i = 0; i < section.enemyCount; i++) {
            const archetype = section.enemyArchetypes[i % section.enemyArchetypes.length] ?? 'patrol';
            entities.push({
              id: nextId('enemy'), type: 'enemy', archetype,
              x: innerX + spacing * (i + 1), y: floorRow - 1,
              params: {
                speed:       1.2 + params.difficulty * 0.8,
                aggroRange:  archetype === 'chaser' ? 100 : 0,
                amp:         archetype === 'flyer'  ? 18  : 0,
                freq:        archetype === 'flyer'  ? 0.03 : 0,
              },
            });
          }
          // Coin reward on any mid-air platform
          entities.push({
            id: nextId('coin'), type: 'collectible', archetype: 'coin',
            x: midX, y: floorRow - 4, params: {},
          });
          break;
        }

        case 'checkpoint': {
          entities.push({
            id: nextId('checkpoint'), type: 'checkpoint', archetype: 'checkpoint',
            x: midX, y: floorRow - 1, params: {},
          });
          // Coin ring around checkpoint
          for (let i = -2; i <= 2; i++)
            entities.push({
              id: nextId('coin'), type: 'collectible', archetype: 'coin',
              x: midX + i * 2, y: floorRow - 4, params: {},
            });
          break;
        }

        case 'finale': {
          // Boss or two chasers depending on difficulty
          if (params.difficulty >= 0.7) {
            entities.push({
              id: nextId('boss'), type: 'enemy', archetype: 'boss',
              x: innerX + innerW - 6, y: floorRow - 4,
              params: { speed: 1.5 + params.difficulty, aggroRange: 200, health: 8 },
            });
          } else {
            for (let i = 0; i < 2; i++)
              entities.push({
                id: nextId('enemy'), type: 'enemy', archetype: 'chaser',
                x: innerX + innerW - 5 - i * 4, y: floorRow - 1,
                params: { speed: 1.5 + params.difficulty * 0.6, aggroRange: 120 },
              });
          }
          break;
        }
      }
    }

    return entities;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARENA LAYOUT
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // A single enclosed space — think Smash Bros Final Destination meets a
  // classic wave-survival arena.  Structure:
  //   - Solid perimeter (left, right, top, bottom walls — 2 tiles thick)
  //   - A solid floor one tile above the bottom wall
  //   - 2-3 tiers of platforms creating vertical play space
  //   - Trigger tile at the centre (starts first wave)
  //   - No exit tile — survival win condition
  //   - All enemies pooled from sections, placed off-screen to drop in

  private buildArena(params: GenerationParams): {
    grid: number[][];
    width: number;
    height: number;
    entities: EntitySpec[];
    spawnPoint: { x: number; y: number };
    exitPoint: { x: number; y: number };
  } {
    // Arena is always a fixed size regardless of section widths.
    // Scale slightly with difficulty so harder arenas have more vertical room.
    const INNER_W = 50 + Math.floor(params.difficulty * 10);   // 50-60 tiles wide
    const INNER_H = 16 + Math.floor(params.difficulty * 4);    // 16-20 tiles tall
    const WALL    = 2;
    const totalWidth  = INNER_W + WALL * 2;
    const totalHeight = INNER_H + WALL * 2;

    const grid: number[][] = Array.from(
      { length: totalHeight },
      () => new Array(totalWidth).fill(TileType.GROUND),
    );

    // ── Hollow interior ──────────────────────────────────────────────────────
    for (let row = WALL; row < totalHeight - WALL; row++)
      for (let col = WALL; col < totalWidth - WALL; col++)
        grid[row][col] = TileType.AIR;

    // ── Main floor (2 tiles above bottom wall) ──────────────────────────────
    const floorRow = totalHeight - WALL - 1;
    for (let col = WALL; col < totalWidth - WALL; col++)
      grid[floorRow][col] = TileType.GROUND;

    // ── Platform tiers ───────────────────────────────────────────────────────
    // Tier 1: two platforms at 30% height, left and right of centre
    const tier1Row = floorRow - 5;
    const tier1LeftEnd  = Math.floor(totalWidth * 0.4);
    const tier1RightStart = Math.floor(totalWidth * 0.55);
    for (let c = WALL + 2; c < tier1LeftEnd; c++)      grid[tier1Row][c] = TileType.PLATFORM;
    for (let c = tier1RightStart; c < totalWidth - WALL - 2; c++) grid[tier1Row][c] = TileType.PLATFORM;

    // Tier 2: one central platform at 60% height
    const tier2Row = floorRow - 9;
    const tier2Start = Math.floor(totalWidth * 0.3);
    const tier2End   = Math.floor(totalWidth * 0.7);
    for (let c = tier2Start; c < tier2End; c++)        grid[tier2Row][c] = TileType.PLATFORM;

    // Tier 3 (hard only): two high platforms near top
    if (params.difficulty >= 0.5) {
      const tier3Row = floorRow - 13;
      const tier3Mid = Math.floor(totalWidth / 2);
      for (let c = tier3Mid - 5; c <= tier3Mid + 5; c++)
        if (tier3Row > WALL + 1) grid[tier3Row][c] = TileType.PLATFORM;
    }

    // ── Hazard pit in the centre of the floor ───────────────────────────────
    if (params.difficulty >= 0.4) {
      const pitHalfW = Math.floor(3 + params.difficulty * 3);
      const pitCentre = Math.floor(totalWidth / 2);
      for (let c = pitCentre - pitHalfW; c <= pitCentre + pitHalfW; c++)
        grid[floorRow][c] = TileType.HAZARD;
    }

    // ── Trigger tile at player spawn (centre floor, slightly left) ───────────
    const trigRow = floorRow - 1;
    const trigCol = WALL + 4;
    grid[trigRow][trigCol] = TileType.TRIGGER;

    // ── Pool all enemies from all sections ───────────────────────────────────
    const entities: EntitySpec[] = [];
    let idCounter = 0;
    const nextId = (prefix: string) => `${prefix}_${++idCounter}`;

    const allEnemyCounts = params.sections.reduce((sum, s) => sum + s.enemyCount, 0);
    const allArchetypes  = params.sections.flatMap(s => s.enemyArchetypes);
    const uniqueArchetypes = allArchetypes.length > 0
      ? [...new Set(allArchetypes)]
      : ['patrol'];

    // Spread enemies along spawn positions just above the arena ceiling
    // (EntitySystem will drop them to ground via gravity)
    for (let i = 0; i < allEnemyCounts; i++) {
      const archetype = uniqueArchetypes[i % uniqueArchetypes.length];
      const spawnX = WALL + 2 + Math.floor((i / allEnemyCounts) * INNER_W);
      entities.push({
        id: nextId('enemy'), type: 'enemy', archetype,
        x: spawnX, y: WALL + 1,   // near ceiling — falls to a platform or floor
        params: {
          speed:      1.0 + params.difficulty * 1.0,
          aggroRange: archetype === 'chaser' ? 200 : 0,
          amp:        archetype === 'flyer'  ? 20  : 0,
          freq:       archetype === 'flyer'  ? 0.03 : 0,
        },
      });
    }

    // A few coins scattered across platforms to give movement incentive
    const coinPositions = [
      { x: WALL + 4,        y: floorRow - 2 },
      { x: totalWidth - WALL - 5, y: floorRow - 2 },
      { x: Math.floor(totalWidth / 2), y: tier2Row - 2 },
      { x: Math.floor(totalWidth * 0.3), y: tier1Row - 2 },
      { x: Math.floor(totalWidth * 0.7), y: tier1Row - 2 },
    ];
    for (const pos of coinPositions)
      entities.push({ id: nextId('coin'), type: 'collectible', archetype: 'coin', ...pos, params: {} });

    const spawnPoint = { x: WALL + 4, y: floorRow - 2 };
    // Arena has no real exit — exitPoint is the trigger position as a symbolic target
    const exitPoint  = { x: totalWidth - WALL - 4, y: floorRow - 2 };

    return { grid, width: totalWidth, height: totalHeight, entities, spawnPoint, exitPoint };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VOICE MOMENT PLACEMENT — per layout
  // ═══════════════════════════════════════════════════════════════════════════

  private placeVoiceMomentsLinear(
    params: GenerationParams,
    grid: number[][],
    mapWidth: number,
  ): VoiceMomentSpec[] {
    const moments: VoiceMomentSpec[] = [];
    if (params.voiceMomentCount <= 0) return moments;

    const zoneStart = Math.floor(mapWidth * 0.50);
    const zoneEnd   = Math.floor(mapWidth * 0.85);
    const zoneWidth = zoneEnd - zoneStart;
    const count     = Math.min(params.voiceMomentCount, 4);

    for (let i = 0; i < count; i++) {
      const trigCol = zoneStart + Math.floor((zoneWidth / (count + 1)) * (i + 1));
      const trigRow = this.GROUND_ROW - 1;

      if (trigCol > 0 && trigCol < mapWidth - 1)
        grid[trigRow][trigCol] = TileType.TRIGGER;

      const doorCol = trigCol + 5;
      for (let row = this.GROUND_ROW - 3; row <= this.GROUND_ROW - 1; row++) {
        if (doorCol     > 0 && doorCol     < mapWidth - 1) grid[row][doorCol]     = TileType.DOOR;
        if (doorCol + 1 > 0 && doorCol + 1 < mapWidth - 1) grid[row][doorCol + 1] = TileType.DOOR;
      }

      moments.push(this.makeMoment(i, trigCol, trigRow));
    }

    return moments;
  }

  private placeVoiceMomentsRooms(
    params: GenerationParams,
    rooms: RoomNode[],
    grid: number[][],
    mapWidth: number,
    mapHeight: number,
  ): VoiceMomentSpec[] {
    const moments: VoiceMomentSpec[] = [];
    if (params.voiceMomentCount <= 0) return moments;

    // Place trigger in the finale room (already has a trigger from carveRoom),
    // and optionally in checkpoint rooms.
    const candidateRooms = rooms.filter(r =>
      r.section.type === 'finale' || r.section.type === 'checkpoint',
    ).slice(0, params.voiceMomentCount);

    for (const [i, room] of candidateRooms.entries()) {
      // Trigger tile is already carved at innerX+2, innerY+innerH-2 in the finale.
      // For checkpoint rooms we add one now.
      const WALL   = 1;
      const innerX = room.tileX + WALL;
      const innerY = room.tileY + WALL;
      const innerH = room.heightTiles - WALL * 2;
      const trigCol = innerX + 2;
      const trigRow = innerY + innerH - 2;

      // Only overwrite if the cell is currently AIR (don't stomp existing triggers)
      if (grid[trigRow]?.[trigCol] === TileType.AIR)
        grid[trigRow][trigCol] = TileType.TRIGGER;

      moments.push(this.makeMoment(i, trigCol, trigRow));
    }

    return moments;
  }

  private placeVoiceMomentsArena(
    params: GenerationParams,
    grid: number[][],
    mapWidth: number,
    mapHeight: number,
  ): VoiceMomentSpec[] {
    if (params.voiceMomentCount <= 0) return [];
    // Arena already has a trigger at (WALL+4, floorRow-1); use it.
    const WALL     = 2;
    const floorRow = mapHeight - WALL - 1;
    const trigCol  = WALL + 4;
    const trigRow  = floorRow - 1;
    return [this.makeMoment(0, trigCol, trigRow)];
  }

  // ─── Shared voice moment factory ───────────────────────────────────────────
  private makeMoment(index: number, trigCol: number, trigRow: number): VoiceMomentSpec {
    const maskTypes: Array<'key_fetch' | 'enemy_wave' | 'traversal'> =
      ['key_fetch', 'enemy_wave', 'traversal'];
    return {
      id:          `vm_${index + 1}`,
      triggerTile: { x: trigCol, y: trigRow },
      prompt:      'What lies beyond this threshold?',
      mapsTo:      ['room_contents', 'enemy_types', 'hazard'],
      mask: {
        type:         maskTypes[index % maskTypes.length],
        minDurationMs: 3000 + index * 500,
        extend:       'spawn_enemy',
      },
      reveal: 'door_open',
      fallbackOptions: [
        'A wave of enemies',
        'Platforms over a lava pit',
        'A powerful weapon',
        'A calm safe passage',
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LINEAR entity placement (kept from original, renamed)
  // ═══════════════════════════════════════════════════════════════════════════

  private placeEntitiesLinear(params: GenerationParams, mapWidth: number): EntitySpec[] {
    const entities: EntitySpec[] = [];
    let idCounter = 0;
    const nextId = (prefix: string) => `${prefix}_${++idCounter}`;

    entities.push(
      { id: nextId('coin'), type: 'collectible', archetype: 'coin', x: 4, y: this.GROUND_ROW - 2, params: {} },
      { id: nextId('coin'), type: 'collectible', archetype: 'coin', x: 6, y: this.GROUND_ROW - 2, params: {} },
      { id: nextId('coin'), type: 'collectible', archetype: 'coin', x: 8, y: this.GROUND_ROW - 2, params: {} },
    );

    let cursor = 8;
    for (const section of params.sections) {
      const sectionEnd = cursor + section.widthTiles;
      const sectionMid = Math.floor((cursor + sectionEnd) / 2);

      switch (section.type) {
        case 'challenge':
        case 'finale': {
          if (section.enemyCount > 0) {
            const spacing = Math.floor(section.widthTiles / (section.enemyCount + 1));
            for (let i = 0; i < section.enemyCount; i++) {
              const archetype = section.enemyArchetypes[i % section.enemyArchetypes.length] ?? 'patrol';
              const jitter = Math.floor((Math.random() - 0.5) * 7);
              const ex = cursor + spacing * (i + 1) + jitter;
              const rowJ = archetype === 'flyer' ? -2 - Math.floor(Math.random() * 3) : 0;
              entities.push({
                id: nextId('enemy'), type: 'enemy', archetype, x: ex, y: this.GROUND_ROW - 1 + rowJ,
                params: {
                  speed:      0.85 + params.difficulty * 0.35,
                  aggroRange: archetype === 'chaser' ? 110 : 0,
                },
              });
            }
          }
          break;
        }
        case 'checkpoint': {
          if (section.hasCheckpoint)
            entities.push({
              id: nextId('checkpoint'), type: 'checkpoint', archetype: 'checkpoint',
              x: sectionMid, y: this.GROUND_ROW - 1, params: {},
            });
          for (let i = -2; i <= 2; i++)
            entities.push({
              id: nextId('coin'), type: 'collectible', archetype: 'coin',
              x: sectionMid + i * 2, y: this.GROUND_ROW - 3, params: {},
            });
          break;
        }
      }
      cursor += section.widthTiles;
    }

    return entities;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARED UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Safe grid write — ignores out-of-bounds coordinates silently. */
  private setGrid(grid: number[][], col: number, row: number, value: number): void {
    if (row < 0 || row >= grid.length || col < 0 || col >= grid[0].length) return;
    grid[row][col] = value;
  }

  /**
   * Safety pass for the linear layout only — for every gap at ground level,
   * ensure at least one bridging platform exists somewhere above it.
   */
  private ensureGapBridges(
    grid: number[][], totalWidth: number, groundRow: number, mapHeight: number,
  ): void {
    let gapStart = -1;

    for (let col = 0; col <= totalWidth; col++) {
      const isAirAtGround =
        col < totalWidth && grid[groundRow][col] !== TileType.GROUND;

      if (isAirAtGround && gapStart === -1) {
        gapStart = col;
      } else if ((!isAirAtGround || col === totalWidth) && gapStart !== -1) {
        const gapEnd = col - 1;

        let hasBridge = false;
        outer: for (let row = 0; row < groundRow; row++)
          for (let c = gapStart; c <= gapEnd; c++)
            if (grid[row][c] === TileType.PLATFORM) { hasBridge = true; break outer; }

        if (!hasBridge) {
          const platRow = groundRow - 3;
          for (let c = Math.max(0, gapStart - 1); c <= Math.min(totalWidth - 1, gapEnd + 1); c++)
            grid[platRow][c] = TileType.PLATFORM;
        }

        gapStart = -1;
      }
    }
  }
}