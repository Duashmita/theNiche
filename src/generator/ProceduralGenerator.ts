import {
  GenerationParams,
  GameSpec,
  MapSection,
  EntitySpec,
  VoiceMomentSpec,
  TileType,
  THEME_PALETTES,
} from '../types';

// ─── ProceduralGenerator ─────────────────────────────────────────────────────
//
// Section-based map generator.
// Takes a GenerationParams (produced by the LLM) and returns a complete
// GameSpec ready to be fed into Tilemap.init() and EntitySystem.init().
//
// Tile type constants (mirrors TileType in types.ts):
//   0 AIR  1 GROUND  2 PLATFORM  3 HAZARD  4 DOOR  5 TRIGGER  6 DECORATION
//
// Coordinates are always in TILE space unless explicitly labelled "pixel".

export class ProceduralGenerator {
  private readonly TILE_SIZE = 16;
  private readonly MAP_HEIGHT = 30;
  private readonly GROUND_ROW = 23;

  // ─── Public entry point ───────────────────────────────────────────────────

  generate(params: GenerationParams): GameSpec {
    const { grid, width } = this.buildTiles(params);

    const entities = this.placeEntities(params, width);
    const voiceMoments = this.placeVoiceMoments(params, grid, width);

    const palette = THEME_PALETTES[params.theme];

    return {
      meta: {
        name: params.title,
        description: params.description,
        difficulty: params.difficulty,
      },
      display: {
        nativeWidth: 320,
        nativeHeight: 180,
        tileSize: this.TILE_SIZE,
        renderScale: 3,
      },
      map: {
        width,
        height: this.MAP_HEIGHT,
        layout: params.layout,
        tiles: grid,
        spawnPoint: { x: 3, y: this.GROUND_ROW - 2 },
        exitPoint:  { x: width - 4, y: this.GROUND_ROW - 2 },
      },
      theme: {
        tileset: params.theme,
        palette: params.palette.length > 0
          ? params.palette
          : [palette.ground, palette.groundTop, palette.platform, palette.hazard],
        backgroundColor: params.backgroundColor || palette.bg,
        music: `${params.theme}_ambient`,
        sfxSet: params.theme,
        parallaxLayers: [],
      },
      player: {
        sprite: 'player',
        abilities: params.abilities,
        health: 3,
      },
      entities,
      rules: params.rules.map((id) => ({ id, params: {} })),
      voiceMoments,
    };
  }

  // ─── Tile grid construction ───────────────────────────────────────────────

  private buildTiles(params: GenerationParams): { grid: number[][]; width: number } {
    const sectionTotalWidth = params.sections.reduce((sum, s) => sum + s.widthTiles, 0);
    const totalWidth = 8 + sectionTotalWidth + 8;

    // Allocate grid — all AIR
    const grid: number[][] = Array.from(
      { length: this.MAP_HEIGHT },
      () => new Array(totalWidth).fill(TileType.AIR),
    );

    // Solid ground from GROUND_ROW to bottom
    for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++) {
      for (let col = 0; col < totalWidth; col++) {
        grid[row][col] = TileType.GROUND;
      }
    }

    // Border walls (2 tiles wide on each side)
    for (let row = 0; row < this.MAP_HEIGHT; row++) {
      grid[row][0] = TileType.GROUND;
      grid[row][1] = TileType.GROUND;
      grid[row][totalWidth - 1] = TileType.GROUND;
      grid[row][totalWidth - 2] = TileType.GROUND;
    }

    // Build each section
    let cursor = 8; // leave an 8-tile safe spawn area
    for (const section of params.sections) {
      this.buildSection(grid, section, cursor, totalWidth, params.difficulty);
      cursor += section.widthTiles;
    }

    // Ensure spawn area is clear (cols 2-7, above ground)
    for (let row = this.GROUND_ROW - 5; row < this.GROUND_ROW; row++) {
      for (let col = 2; col <= 7; col++) {
        grid[row][col] = TileType.AIR;
      }
    }

    // Ensure exit area is clear (last 8 cols, above ground)
    for (let row = this.GROUND_ROW - 5; row < this.GROUND_ROW; row++) {
      for (let col = totalWidth - 8; col < totalWidth - 2; col++) {
        if (col >= 0 && col < totalWidth) {
          grid[row][col] = TileType.AIR;
        }
      }
    }

    // Safety pass: for every gap at ground level, ensure a bridging platform exists
    this.ensureGapBridges(grid, totalWidth);

    return { grid, width: totalWidth };
  }

  // ─── Per-section tile placement ───────────────────────────────────────────

  private buildSection(
    grid: number[][],
    section: MapSection,
    startCol: number,
    totalWidth: number,
    difficulty: number,
  ): void {
    const endCol = startCol + section.widthTiles;

    switch (section.type) {
      case 'intro': {
        // Leave ground intact — straight path for orientation
        if (section.widthTiles > 18) {
          // One optional gap at the 60% mark to introduce jumping
          const gapCenter = Math.floor(startCol + section.widthTiles * 0.6);
          // Gap is 2–3 tiles, never more than 3
          const gapWidth = Math.min(2 + (difficulty > 0.5 ? 1 : 0), 3);
          const gapStart = gapCenter - Math.floor(gapWidth / 2);

          if (gapStart + gapWidth < endCol - 2 && gapStart > startCol + 2) {
            // Carve the gap
            for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++) {
              for (let col = gapStart; col < gapStart + gapWidth; col++) {
                grid[row][col] = TileType.AIR;
              }
            }

            // Platform bridging the gap (1 tile on each side of the gap)
            const platRow = this.GROUND_ROW - 3;
            for (let col = gapStart - 1; col <= gapStart + gapWidth; col++) {
              if (col >= 0 && col < totalWidth) {
                grid[platRow][col] = TileType.PLATFORM;
              }
            }
          }
        }
        break;
      }

      case 'challenge': {
        // Number of gaps: 1–3, scaled by difficulty (max 3)
        const numGaps = Math.min(1 + Math.floor(difficulty * 2.5), 3);
        const spaceBetweenGaps = Math.floor((section.widthTiles - 4) / (numGaps + 1));

        for (let i = 0; i < numGaps; i++) {
          const gapStart = startCol + 2 + spaceBetweenGaps * (i + 1);
          // Gap width: 2–4 tiles, hazard fills if density is high
          const gapWidth = Math.min(2 + Math.floor(section.hazardDensity * 2), 4);

          // Safety: never let the gap overflow the section boundary
          if (gapStart + gapWidth >= endCol - 2) continue;

          // Carve ground tiles for the gap
          for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++) {
            for (let col = gapStart; col < gapStart + gapWidth; col++) {
              grid[row][col] = TileType.AIR;
            }
          }

          // Fill gap floor with HAZARD if density warrants it
          if (section.hazardDensity > 0.4) {
            for (let col = gapStart; col < gapStart + gapWidth; col++) {
              grid[this.GROUND_ROW][col] = TileType.HAZARD;
            }
          }

          // Platform above the gap — height varies with difficulty (easier = lower)
          const platHeight = Math.round(2 + difficulty * 2); // 2–4 rows above ground
          const platRow = Math.min(
            Math.max(this.GROUND_ROW - platHeight, this.GROUND_ROW - 4),
            this.GROUND_ROW - 2,
          );
          // Span: 1 tile before gap to 1 tile after gap
          for (let col = gapStart - 1; col <= gapStart + gapWidth; col++) {
            if (col >= 0 && col < totalWidth) {
              grid[platRow][col] = TileType.PLATFORM;
            }
          }
        }
        break;
      }

      case 'checkpoint':
        // Flat ground, no obstacles — used as breathing room
        break;

      case 'finale': {
        // Similar to challenge but always exactly 1 gap for clarity
        const finaleGapOffset = Math.floor(section.widthTiles * 0.35);
        const finaleGapStart = startCol + finaleGapOffset;
        const finaleGapWidth = Math.min(3, 4); // exactly 3 — comfortably jumpable

        if (finaleGapStart + finaleGapWidth < endCol - 2) {
          for (let row = this.GROUND_ROW; row < this.MAP_HEIGHT; row++) {
            for (let col = finaleGapStart; col < finaleGapStart + finaleGapWidth; col++) {
              grid[row][col] = TileType.AIR;
            }
          }
          // Hazard floor in the finale gap
          for (let col = finaleGapStart; col < finaleGapStart + finaleGapWidth; col++) {
            grid[this.GROUND_ROW][col] = TileType.HAZARD;
          }
          // Elevated platform over the gap
          const platRow = this.GROUND_ROW - 3;
          for (let col = finaleGapStart - 1; col <= finaleGapStart + finaleGapWidth; col++) {
            if (col >= 0 && col < totalWidth) {
              grid[platRow][col] = TileType.PLATFORM;
            }
          }
        }

        // Place a TRIGGER tile just inside the finale section
        const trigRow = this.GROUND_ROW - 1;
        const trigCol = startCol + 3;
        if (trigCol < endCol - 2 && trigRow >= 0) {
          grid[trigRow][trigCol] = TileType.TRIGGER;
        }
        break;
      }

      default:
        break;
    }
  }

  // ─── Safety pass: bridge any unplatformed gaps ────────────────────────────

  private ensureGapBridges(grid: number[][], totalWidth: number): void {
    // Scan left-to-right at ground row; for any run of AIR columns, verify
    // there is at least one PLATFORM tile somewhere above them.
    let gapStart = -1;

    for (let col = 0; col <= totalWidth; col++) {
      const isAirAtGround =
        col < totalWidth && grid[this.GROUND_ROW][col] !== TileType.GROUND;

      if (isAirAtGround && gapStart === -1) {
        gapStart = col;
      } else if ((!isAirAtGround || col === totalWidth) && gapStart !== -1) {
        const gapEnd = col - 1;

        // Check whether any platform tile bridges this gap
        let hasBridge = false;
        for (let row = 0; row < this.GROUND_ROW; row++) {
          for (let c = gapStart; c <= gapEnd; c++) {
            if (grid[row][c] === TileType.PLATFORM) {
              hasBridge = true;
              break;
            }
          }
          if (hasBridge) break;
        }

        if (!hasBridge) {
          // Add a minimal platform covering the entire gap
          const platRow = this.GROUND_ROW - 3;
          for (let c = Math.max(0, gapStart - 1); c <= Math.min(totalWidth - 1, gapEnd + 1); c++) {
            grid[platRow][c] = TileType.PLATFORM;
          }
        }

        gapStart = -1;
      }
    }
  }

  // ─── Entity placement ─────────────────────────────────────────────────────

  private placeEntities(params: GenerationParams, mapWidth: number): EntitySpec[] {
    const entities: EntitySpec[] = [];
    let idCounter = 0;
    const nextId = (prefix: string) => `${prefix}_${++idCounter}`;

    let cursor = 8;

    // Intro section: 3 coins in a row near the start regardless of spec
    entities.push(
      { id: nextId('coin'), type: 'collectible', archetype: 'coin', x: 4, y: this.GROUND_ROW - 2, params: {} },
      { id: nextId('coin'), type: 'collectible', archetype: 'coin', x: 6, y: this.GROUND_ROW - 2, params: {} },
      { id: nextId('coin'), type: 'collectible', archetype: 'coin', x: 8, y: this.GROUND_ROW - 2, params: {} },
    );

    for (const section of params.sections) {
      const sectionEnd = cursor + section.widthTiles;
      const sectionMid = Math.floor((cursor + sectionEnd) / 2);

      switch (section.type) {
        case 'challenge':
        case 'finale': {
          // Distribute enemies evenly across the section
          if (section.enemyCount > 0) {
            const spacing = Math.floor(section.widthTiles / (section.enemyCount + 1));
            for (let i = 0; i < section.enemyCount; i++) {
              const archetype =
                section.enemyArchetypes[i % section.enemyArchetypes.length] ?? 'patrol';
              const ex = cursor + spacing * (i + 1);
              entities.push({
                id: nextId('enemy'),
                type: 'enemy',
                archetype,
                x: ex,
                y: this.GROUND_ROW - 1,
                params: {
                  speed: 1.2 + params.difficulty * 0.8,
                  aggroRange: archetype === 'chaser' ? 120 : 0,
                },
              });
            }
          }
          break;
        }

        case 'checkpoint': {
          // Always place a checkpoint entity at the section midpoint
          if (section.hasCheckpoint) {
            entities.push({
              id: nextId('checkpoint'),
              type: 'checkpoint',
              archetype: 'checkpoint',
              x: sectionMid,
              y: this.GROUND_ROW - 1,
              params: {},
            });
          }
          // A few coins as reward
          for (let i = -2; i <= 2; i++) {
            entities.push({
              id: nextId('coin'),
              type: 'collectible',
              archetype: 'coin',
              x: sectionMid + i * 2,
              y: this.GROUND_ROW - 3,
              params: {},
            });
          }
          break;
        }

        default:
          break;
      }

      cursor += section.widthTiles;
    }

    return entities;
  }

  // ─── Voice moment placement ───────────────────────────────────────────────

  private placeVoiceMoments(
    params: GenerationParams,
    grid: number[][],
    mapWidth: number,
  ): VoiceMomentSpec[] {
    const moments: VoiceMomentSpec[] = [];
    if (params.voiceMomentCount <= 0) return moments;

    // Spread triggers evenly in the 50%–85% band of the map
    const zoneStart = Math.floor(mapWidth * 0.50);
    const zoneEnd   = Math.floor(mapWidth * 0.85);
    const zoneWidth = zoneEnd - zoneStart;

    const count = Math.min(params.voiceMomentCount, 4); // sanity cap

    for (let i = 0; i < count; i++) {
      const trigCol = zoneStart + Math.floor((zoneWidth / (count + 1)) * (i + 1));
      const trigRow = this.GROUND_ROW - 1; // on the surface so the player walks over it

      // Place trigger tile in the grid
      if (trigCol > 0 && trigCol < mapWidth - 1) {
        grid[trigRow][trigCol] = TileType.TRIGGER;
      }

      // Place a DOOR 5 tiles ahead (3 rows tall)
      const doorCol = trigCol + 5;
      for (let row = this.GROUND_ROW - 3; row <= this.GROUND_ROW - 1; row++) {
        if (doorCol > 0 && doorCol < mapWidth - 1) {
          grid[row][doorCol] = TileType.DOOR;
        }
        if (doorCol + 1 > 0 && doorCol + 1 < mapWidth - 1) {
          grid[row][doorCol + 1] = TileType.DOOR;
        }
      }

      const maskTypes: Array<'key_fetch' | 'enemy_wave' | 'traversal'> = [
        'key_fetch',
        'enemy_wave',
        'traversal',
      ];

      moments.push({
        id: `vm_${i + 1}`,
        triggerTile: { x: trigCol, y: trigRow },
        prompt: `What lies beyond this threshold?`,
        mapsTo: ['room_contents', 'enemy_types', 'hazard'],
        mask: {
          type: maskTypes[i % maskTypes.length],
          minDurationMs: 3000 + i * 500,
          extend: 'spawn_enemy',
        },
        reveal: 'door_open',
        fallbackOptions: [
          'A wave of enemies',
          'Platforms over a lava pit',
          'A powerful weapon',
          'A calm safe passage',
        ],
      });
    }

    return moments;
  }
}
