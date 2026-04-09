import { EventBus } from '../engine/EventBus';
import {
  SharedState,
  VoiceMomentPhase,
  VoiceMomentSpec,
  VoiceMomentResponse,
  StateChange,
  GameSpec,
} from '../types';
import { Tilemap } from '../engine/Tilemap';
import { EntitySystem } from '../engine/EntitySystem';

// ─── Structural dependency interface ─────────────────────────────────────────
// Accept voice pipeline + LLM client via constructor so we avoid hard coupling.

interface VoiceDeps {
  listen: (onInterim?: (t: string) => void) => Promise<string>;
  processVoiceMoment: (
    transcript: string,
    moment: VoiceMomentSpec,
    context: string,
  ) => Promise<VoiceMomentResponse>;
}

// ─── VoiceMomentSystem ────────────────────────────────────────────────────────

export class VoiceMomentSystem {
  // ── Public state (read by UI overlay) ─────────────────────────────────────
  phase = VoiceMomentPhase.IDLE;
  currentMoment: VoiceMomentSpec | null = null;
  pendingResult: VoiceMomentResponse | null = null;
  interpretation = '';   // shown in UI overlay

  // ── Private state ─────────────────────────────────────────────────────────
  private maskStartTime = 0;
  private maskMinDuration = 0;
  private maskKeyCollected = false;  // for key_fetch masking pattern
  private revealTimer = 0;
  private readonly REVEAL_DURATION = 600;   // ms for reveal animation
  private readonly LLM_TIMEOUT = 10000;     // 10 s fallback
  private spec: GameSpec | null = null;

  constructor(private readonly events: EventBus, private readonly voice: VoiceDeps) {
    // ── Listen for player stepping on a trigger tile ───────────────────────
    this.events.on('player_entered_trigger', (data: {
      tileKey: string;
      tileX: number;
      tileY: number;
    }) => {
      if (!this.spec) return;
      if (this.phase !== VoiceMomentPhase.IDLE) return;

      const match = this.spec.voiceMoments.find(
        (vm) => vm.triggerTile.x === data.tileX && vm.triggerTile.y === data.tileY,
      );
      if (match) {
        // We need tilemap + entitySystem at trigger time; store them via the
        // public update-time path.  Callers that directly fire the trigger
        // should use onPlayerEnteredTrigger() instead.
        // If called via the event bus we fall back gracefully (no action) —
        // the GameLoop should call onPlayerEnteredTrigger() for proper context.
        this.interpretation = match.prompt;
      }
    });

    // ── Listen for key collection (key_fetch mask completion) ─────────────
    this.events.on('collectible_picked_up', (data: { entity: { archetype: string } }) => {
      if (data?.entity?.archetype === 'key') {
        this.maskKeyCollected = true;
      }
    });
  }

  // ─── Called when a new game/spec loads ────────────────────────────────────

  setSpec(spec: GameSpec): void {
    this.spec = spec;
  }

  // ─── Main update — called every frame by the game loop ────────────────────

  update(
    events: EventBus,
    state: SharedState,
    tilemap: Tilemap,
    entitySystem: EntitySystem,
    dt: number,
  ): void {
    switch (this.phase) {
      case VoiceMomentPhase.IDLE:
        // Nothing to do.
        break;

      case VoiceMomentPhase.LISTENING:
        // captureAndProcess() transitions us to PROCESSING asynchronously.
        break;

      case VoiceMomentPhase.PROCESSING: {
        const elapsed = performance.now() - this.maskStartTime;

        // If the LLM is taking longer than the mask window, keep the player busy.
        if (elapsed > this.maskMinDuration && !this.pendingResult) {
          this.extendMask(entitySystem, tilemap);
        }

        const maskComplete = elapsed >= this.maskMinDuration;

        if (this.pendingResult && maskComplete) {
          this.phase = VoiceMomentPhase.READY;
          events.emit('voice_moment_ready', { interpretation: this.interpretation });
        }
        break;
      }

      case VoiceMomentPhase.READY: {
        // For key_fetch mask: wait until the player has grabbed the key.
        // For all other masks: reveal immediately.
        const readyToReveal =
          this.currentMoment?.mask.type === 'key_fetch'
            ? this.maskKeyCollected
            : true;

        if (readyToReveal && this.pendingResult) {
          this.applyResult(tilemap, entitySystem, events, state);
          this.revealTimer = this.REVEAL_DURATION;
          this.phase = VoiceMomentPhase.REVEALING;
          events.emit('voice_moment_revealed', { response: this.pendingResult });
        }
        break;
      }

      case VoiceMomentPhase.REVEALING:
        this.revealTimer -= dt;
        if (this.revealTimer <= 0) {
          this.phase = VoiceMomentPhase.IDLE;
          this.currentMoment = null;
          this.pendingResult = null;
          this.interpretation = '';
          this.maskKeyCollected = false;
          state.phase = 'gameplay';
        }
        break;
    }
  }

  // ─── Trigger a voice moment ───────────────────────────────────────────────

  trigger(
    moment: VoiceMomentSpec,
    events: EventBus,
    state: SharedState,
    entitySystem: EntitySystem,
    tilemap: Tilemap,
  ): void {
    this.currentMoment = moment;
    this.phase = VoiceMomentPhase.LISTENING;
    this.maskStartTime = performance.now();
    this.maskMinDuration = moment.mask.minDurationMs;
    state.phase = 'voice_moment';

    events.emit('voice_moment_triggered', { moment });

    // Begin the masking sequence (synchronous — spawns entities / tiles now)
    this.startMask(moment.mask.type, entitySystem, tilemap);

    // Begin async voice capture + LLM (non-blocking)
    this.captureAndProcess(moment, events);
  }

  // ─── Public helper: called by the game loop when player enters trigger ────

  onPlayerEnteredTrigger(
    tileKey: string,
    tileX: number,
    tileY: number,
    events: EventBus,
    state: SharedState,
    entitySystem: EntitySystem,
    tilemap: Tilemap,
  ): void {
    if (!this.spec) return;
    if (this.phase !== VoiceMomentPhase.IDLE) return;

    const match = this.spec.voiceMoments.find(
      (vm) => vm.triggerTile.x === tileX && vm.triggerTile.y === tileY,
    );

    if (match) {
      this.trigger(match, events, state, entitySystem, tilemap);
    }
  }

  // ─── Private: start the masking distraction ───────────────────────────────

  private startMask(type: string, entitySystem: EntitySystem, tilemap: Tilemap): void {
    switch (type) {
      case 'key_fetch':
        // Spawn a key to the right and two patrol enemies to guard the path.
        entitySystem.spawnKey(tilemap.worldPixelWidth * 0.7, tilemap);
        entitySystem.spawnMaskEnemies(2, tilemap.worldPixelWidth * 0.5, tilemap);
        break;

      case 'enemy_wave':
        entitySystem.spawnMaskEnemies(4, tilemap.worldPixelWidth * 0.5, tilemap);
        break;

      case 'traversal':
      case 'craft_animation':
      case 'npc_dialogue':
        // These masks rely purely on their timer — no extra entities needed.
        break;

      default:
        break;
    }
  }

  // ─── Private: extend mask when LLM is slow ────────────────────────────────

  private extendMask(entitySystem: EntitySystem, tilemap: Tilemap): void {
    // Spawn 1 more patrol enemy to keep the player occupied.
    entitySystem.spawnMaskEnemies(1, tilemap.worldPixelWidth * 0.5, tilemap);
  }

  // ─── Private: async voice capture + LLM ──────────────────────────────────

  private async captureAndProcess(moment: VoiceMomentSpec, events: EventBus): Promise<void> {
    try {
      this.phase = VoiceMomentPhase.PROCESSING;
      events.emit('voice_moment_listening', {});

      // Race: speech recognition vs. hard timeout
      const transcript = await Promise.race([
        this.voice.listen((interim) => {
          // Stream interim result to UI
          this.interpretation = interim;
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), this.LLM_TIMEOUT),
        ),
      ]);

      events.emit('voice_moment_processing', {});
      this.interpretation = transcript || '(silent)';

      const gameContext = this.buildGameContext();

      // Race: LLM inference vs. hard timeout
      const result = await Promise.race([
        this.voice.processVoiceMoment(transcript, moment, gameContext),
        new Promise<VoiceMomentResponse>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), this.LLM_TIMEOUT),
        ),
      ]);

      this.pendingResult = result;
      this.interpretation = result.interpretation;
    } catch {
      // Fallback: use pre-generated safe content so the game can continue
      this.pendingResult = this.buildFallback(moment);
      this.interpretation = 'Something unexpected...';
    }
  }

  // ─── Private: build fallback response when voice/LLM is unavailable ──────

  private buildFallback(moment: VoiceMomentSpec): VoiceMomentResponse {
    return {
      voiceMomentId: moment.id,
      interpretation: moment.fallbackOptions?.[0] ?? 'Enemies appear',
      stateChanges: [
        {
          action: 'spawn_enemies',
          archetype: 'patrol',
          count: 3,
          visual: 'standard',
        } as StateChange,
        {
          action: 'add_platforms',
          count: 2,
          aboveHazard: false,
        } as StateChange,
      ],
    };
  }

  // ─── Private: build concise game context string for the LLM ──────────────

  private buildGameContext(): string {
    if (this.spec) {
      const abilities = this.spec.player.abilities.join(', ') || 'none';
      const theme = this.spec.theme.tileset;
      const difficulty = this.spec.meta.difficulty.toFixed(2);
      return (
        `Linear platformer, ${theme} theme, player abilities: ${abilities}, ` +
        `difficulty: ${difficulty}`
      );
    }
    // Generic fallback context
    return 'Linear platformer, forest theme, player has double_jump';
  }

  // ─── Private: apply LLM result changes to the world ──────────────────────

  private applyResult(
    tilemap: Tilemap,
    entitySystem: EntitySystem,
    events: EventBus,
    state: SharedState,
  ): void {
    for (const change of this.pendingResult!.stateChanges) {
      switch (change.action) {
        case 'spawn_enemies': {
          const count = Math.min((change.count as number) || 2, 5);
          entitySystem.spawnMaskEnemies(count, tilemap.worldPixelWidth * 0.6, tilemap);
          break;
        }

        case 'add_platforms': {
          const count = Math.min((change.count as number) || 3, 6);
          const groundRow = Math.floor(tilemap.mapHeight * 0.75);
          const midX = Math.floor(tilemap.mapWidth * 0.6);
          for (let i = 0; i < count; i++) {
            const platRow = groundRow - 3 - i * 2;
            const platCol = midX + (i % 2 === 0 ? -4 : 4) + i;
            if (platRow > 0 && platCol > 0 && platCol < tilemap.mapWidth - 5) {
              tilemap.setTile(platCol,     platRow, 2); // PLATFORM
              tilemap.setTile(platCol + 1, platRow, 2);
              tilemap.setTile(platCol + 2, platRow, 2);
            }
          }
          break;
        }

        case 'modify_terrain': {
          const tileType = (change.tileType as number) || 3;
          const groundRow = Math.floor(tilemap.mapHeight * 0.75);
          const midX = Math.floor(tilemap.mapWidth * 0.65);
          for (let row = groundRow; row < groundRow + 2; row++) {
            for (let col = midX; col < midX + 6; col++) {
              if (col > 0 && col < tilemap.mapWidth - 1) {
                tilemap.setTile(col, row, tileType);
              }
            }
          }
          break;
        }

        case 'give_weapon':
          state.activeWeapon = (change.type as string) || 'sword';
          break;

        case 'spawn_boss':
          entitySystem.spawnEnemy({
            id: 'boss_1',
            type: 'enemy',
            archetype: 'boss',
            x: Math.floor(tilemap.mapWidth * 0.75),
            y: Math.floor(tilemap.mapHeight * 0.75) - 2,
            params: { speed: 2, aggroRange: 200, health: 8 },
          });
          break;

        case 'change_music':
          events.emit('music_change', { mood: change.mood });
          break;

        case 'fill_room': {
          const hazardY =
            (change.yLevel as number) || Math.floor(tilemap.mapHeight * 0.75);
          const startCol = Math.floor(tilemap.mapWidth * 0.6);

          // Lay hazard tiles across the reveal zone floor
          for (let col = startCol; col < startCol + 8; col++) {
            if (col < tilemap.mapWidth - 1) {
              tilemap.setTile(col, hazardY, 3); // HAZARD
            }
          }

          // Always add escape platforms so the level remains completable
          for (let i = 0; i < 3; i++) {
            const platCol = startCol + i * 3;
            if (platCol < tilemap.mapWidth - 2) {
              tilemap.setTile(platCol,     hazardY - 3, 2); // PLATFORM above hazard
              tilemap.setTile(platCol + 1, hazardY - 3, 2);
            }
          }
          break;
        }

        default:
          break;
      }
    }

    // Open every DOOR tile in the reveal zone (right 45% of the map)
    const revealStart = Math.floor(tilemap.mapWidth * 0.55);
    for (let col = revealStart; col < tilemap.mapWidth; col++) {
      for (let row = 0; row < tilemap.mapHeight; row++) {
        if (tilemap.getTileAt(col, row) === 4) { // DOOR
          tilemap.openDoor(col, row);
        }
      }
    }
  }
}
