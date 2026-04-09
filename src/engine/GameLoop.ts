import { EventBus } from './EventBus';
import { Tilemap } from './Tilemap';
import { InputSystem } from './InputSystem';
import { PlayerController } from './PlayerController';
import { PhysicsSystem } from './PhysicsSystem';
import { EntitySystem } from './EntitySystem';
import { Camera } from './Camera';
import { Renderer } from './Renderer';
import { JuiceSystem } from './JuiceSystem';
import { SharedState } from '../types';

// RulesEngine is in the rules/ folder — import type to avoid circular dep.
// The concrete instance is passed in as `any` and wrapped in a minimal interface.
interface RulesEngine {
  update(state: SharedState, dt: number): void;
}

// AudioManager is passive (only listens to events) — no per-frame update needed.
interface AudioManager {
  // intentionally empty
}

/**
 * VoiceMomentSystem lives in the voice/ folder.  We take a structural type
 * instead of a concrete import to keep the dependency graph acyclic.
 */
type VoiceMomentSystem = {
  update(
    events: EventBus,
    state: SharedState,
    tilemap: Tilemap,
    entitySystem: EntitySystem,
    dt: number,
  ): void;
};

/**
 * GameLoop wires all engine systems together and drives them at 60 fps via
 * requestAnimationFrame.  The update order below is fixed — changing it will
 * break physics, juice, and voice-moment timing.
 */
export class GameLoop {
  private readonly input:             InputSystem;
  private readonly player:            PlayerController;
  private readonly physics:           PhysicsSystem;
  private readonly entitySystem:      EntitySystem;
  private readonly rules:             RulesEngine;
  private readonly camera:            Camera;
  private readonly renderer:          Renderer;
  private readonly juice:             JuiceSystem;
  private readonly audio:             AudioManager;
  private readonly events:            EventBus;
  private readonly tilemap:           Tilemap;
  private readonly state:             SharedState;
  private readonly voiceMomentSystem: VoiceMomentSystem;

  private rafId:         number | null = null;
  private lastTimestamp: number        = 0;
  private running:       boolean       = false;

  constructor(
    input:             InputSystem,
    player:            PlayerController,
    physics:           PhysicsSystem,
    entitySystem:      EntitySystem,
    rules:             RulesEngine,
    camera:            Camera,
    renderer:          Renderer,
    juice:             JuiceSystem,
    audio:             AudioManager,
    events:            EventBus,
    tilemap:           Tilemap,
    state:             SharedState,
    voiceMomentSystem: VoiceMomentSystem,
  ) {
    this.input             = input;
    this.player            = player;
    this.physics           = physics;
    this.entitySystem      = entitySystem;
    this.rules             = rules;
    this.camera            = camera;
    this.renderer          = renderer;
    this.juice             = juice;
    this.audio             = audio;
    this.events            = events;
    this.tilemap           = tilemap;
    this.state             = state;
    this.voiceMomentSystem = voiceMomentSystem;
  }

  /** Launch the requestAnimationFrame loop. Safe to call multiple times. */
  start(): void {
    if (this.running) return;
    this.running       = true;
    this.lastTimestamp = performance.now();
    this.rafId         = requestAnimationFrame(this.tick);
  }

  /** Halt the loop. The current frame (if any) will complete normally. */
  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core tick — called once per animation frame
  // ─────────────────────────────────────────────────────────────────────────

  private tick = (currentTimestamp: number): void => {
    if (!this.running) return;

    // Cap dt at 50 ms to prevent physics explosions after the tab loses focus.
    const dt = Math.min(currentTimestamp - this.lastTimestamp, 50);
    this.lastTimestamp = currentTimestamp;

    // ── 1. Input (always runs) ───────────────────────────────────────────────
    this.input.update();

    const frozen = this.juice.isFrozen();

    // ── 2. Player ────────────────────────────────────────────────────────────
    if (!frozen) {
      this.player.update(this.input, this.events, this.state, this.tilemap);
    }

    // ── 3. Physics ───────────────────────────────────────────────────────────
    if (!frozen) {
      this.physics.update(this.player, this.tilemap, this.events, this.state);
    }

    // ── 4. Entity system ─────────────────────────────────────────────────────
    if (!frozen) {
      this.entitySystem.update(this.player, this.tilemap, this.events, dt);
    }

    // ── 5. Rules engine ──────────────────────────────────────────────────────
    if (!frozen) {
      this.rules.update(this.state, dt);
    }

    // ── 6. Camera (tracks player even during freeze so it's ready when unfrozen)
    this.camera.update(
      this.player,
      this.tilemap.worldPixelWidth,
      this.tilemap.worldPixelHeight,
    );

    // ── 7. Render ────────────────────────────────────────────────────────────
    this.renderer.render(
      this.state,
      this.player,
      this.entitySystem.entities,
      this.tilemap,
      this.camera,
      this.juice,
    );

    // ── 8. Juice (screen-shake decay, freeze-frame timer, particle step) ─────
    this.juice.update(dt);

    // ── 9. Voice moment (always runs — manages its own frozen-state logic) ───
    this.voiceMomentSystem.update(
      this.events,
      this.state,
      this.tilemap,
      this.entitySystem,
      dt,
    );

    // ── 10. Advance frame counter ────────────────────────────────────────────
    this.state.frameCount++;

    this.rafId = requestAnimationFrame(this.tick);
  };
}
