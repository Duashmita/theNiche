import { EventBus }         from './engine/EventBus';
import { GameLoop }         from './engine/GameLoop';
import { Tilemap }          from './engine/Tilemap';
import { InputSystem }      from './engine/InputSystem';
import { PlayerController } from './engine/PlayerController';
import { PhysicsSystem }    from './engine/PhysicsSystem';
import { EntitySystem }     from './engine/EntitySystem';
import { RulesEngine }      from './engine/RulesEngine';
import { Camera }           from './engine/Camera';
import { Renderer }         from './engine/Renderer';
import { JuiceSystem }      from './engine/JuiceSystem';
import { AudioManager }     from './engine/AudioManager';
import { VoicePipeline }    from './voice/VoicePipeline';
import { LLMClient }        from './voice/LLMClient';
import { AssetGenerator }   from './engine/AssetGenerator';
import { LoadingScreen }    from './ui/LoadingScreen';
import { VoiceMomentOverlay } from './ui/VoiceMomentOverlay';
import { SharedState, GameSpec, ThemeId, StateChange, AssetMap } from './types';

// ─── HTML elements ─────────────────────────────────────────────────────────────
const displayCanvas   = document.getElementById('display-canvas') as HTMLCanvasElement;
const uiOverlay       = document.getElementById('ui-overlay')     as HTMLDivElement;
const micBtn          = document.getElementById('mic-btn')        as HTMLButtonElement;
const textInput       = document.getElementById('text-input')     as HTMLInputElement;
const submitBtn       = document.getElementById('submit-btn')     as HTMLButtonElement;
const transcriptEl    = document.getElementById('transcript')     as HTMLDivElement;

// ─── Native canvas (320×180) drawn to, then scaled to display canvas ───────────
const nativeCanvas = document.createElement('canvas');
nativeCanvas.width  = 320;
nativeCanvas.height = 180;

// ─── Create all systems ────────────────────────────────────────────────────────
const events       = new EventBus();
const tilemap      = new Tilemap();
const input        = new InputSystem();
const player       = new PlayerController();
const physics      = new PhysicsSystem();
const entitySystem = new EntitySystem(events);
const rules        = new RulesEngine(events);
const camera       = new Camera();
const renderer     = new Renderer(nativeCanvas, displayCanvas);
const juice        = new JuiceSystem(events, player);
const audio        = new AudioManager(events);

const voicePipeline   = new VoicePipeline();
const llmClient       = new LLMClient(
  (import.meta as any).env?.VITE_GEMINI_KEY ?? '',
);
const assetGenerator  = new AssetGenerator(
  (import.meta as any).env?.VITE_REPLICATE_KEY ?? '',
);

const loadingScreen       = new LoadingScreen(nativeCanvas);
const voiceMomentOverlay  = new VoiceMomentOverlay(uiOverlay, events);

// ─── Shared mutable game state ─────────────────────────────────────────────────
const state: SharedState = {
  spec:         null,
  phase:        'loading',
  gravity:      0.8,
  score:        0,
  health:       3,
  maxHealth:    3,
  frameCount:   0,
  triggeredTiles: new Set(),
  activeWeapon: null,
  gameOver:     false,
};

// ─── VoiceMomentSystem (imported lazily to break circular dep) ─────────────────
// We wire it as a structural type so GameLoop doesn't need to import from voice/
let voiceMomentSystemModule: any = null;

async function loadVoiceMomentSystem() {
  const mod = await import('./voice/VoiceMomentSystem');
  voiceMomentSystemModule = new mod.VoiceMomentSystem(events, {
    listen: (onInterim?: (t: string) => void) =>
      voicePipeline.listen((t) => {
        if (onInterim) onInterim(t);
        events.emit('voice_interim', { text: t });
        transcriptEl.textContent = t;
        voiceMomentOverlay.updateInterim(t);
      }),
    processVoiceMoment: (transcript: string, moment: any, context: string) =>
      llmClient.processVoiceMoment(transcript, moment, context),
  });
  return voiceMomentSystemModule;
}

// Stub that does nothing until real system loads
const vmStub = {
  update: () => {},
  setSpec: (_s: GameSpec) => {},
  onPlayerEnteredTrigger: () => {},
};

// Proxy that forwards to real system once loaded
const voiceMomentProxy = {
  update(events: EventBus, state: SharedState, tilemap: Tilemap, entitySystem: EntitySystem, dt: number) {
    voiceMomentSystemModule?.update(events, state, tilemap, entitySystem, dt);
  },
};

// ─── Game loop ─────────────────────────────────────────────────────────────────
const gameLoop = new GameLoop(
  input, player, physics, entitySystem, rules,
  camera, renderer, juice, audio,
  events, tilemap, state,
  voiceMomentProxy,
);

// ─── initGame: wire all systems from a GameSpec ────────────────────────────────
function initGame(spec: GameSpec): void {
  state.spec         = spec;
  state.phase        = 'gameplay';
  state.gravity      = 0.8;
  state.score        = 0;
  state.health       = spec.player.health;
  state.maxHealth    = spec.player.health;
  state.frameCount   = 0;
  state.activeWeapon = null;
  state.gameOver     = false;
  state.triggeredTiles.clear();

  tilemap.init(spec);
  player.initFromSpec(spec.player, spec.map.spawnPoint.x, spec.map.spawnPoint.y, spec.display.tileSize);
  entitySystem.init(spec.entities);
  rules.init(spec.rules, tilemap);

  // Give voice moment system the new spec
  voiceMomentSystemModule?.setSpec(spec);
}

// ─── Listen for player events that need cross-system handling ──────────────────
events.on('player_damaged_by_enemy', () => {
  player.takeDamage(events, state);
});

events.on('player_stomp_bounce', () => {
  // EntitySystem emits this so player bounces without directly calling player methods
  if (player.vy > 0) player.vy = -10;
});

events.on('collectible_picked_up', () => {
  state.score += 100;
});

events.on('checkpoint_reached', () => {
  // Could save respawn point — for now just log
  console.log('Checkpoint!');
});

events.on('voice_moment_revealed', (payload: { response: { stateChanges: StateChange[] } }) => {
  if (!state.spec || !assetGenerator.hasKey()) return;
  const hasVisualChange = payload.response.stateChanges.some(
    (c) => c.action === 'modify_terrain' || c.action === 'fill_room',
  );
  if (hasVisualChange) {
    const themeId = state.spec.theme.tileset as ThemeId;
    const palette = state.spec.theme.palette;
    const description = state.spec.meta.description;
    assetGenerator.regenerateTerrain(themeId, palette, description).then((updated) => {
      renderer.patchAssets(updated);
    }).catch(() => { /* keep existing assets */ });
  }
});

events.on('player_died', () => {
  state.gameOver = true;
  state.phase    = 'game_over';
  // Auto-respawn after 1.5 seconds
  setTimeout(() => {
    if (state.spec) {
      initGame(state.spec);
    }
  }, 1500);
});

// ─── Boot sequence ─────────────────────────────────────────────────────────────
async function boot() {
  // Load demo spec immediately so something is visible right away
  const { DEMO_SPEC } = await import('./generator/DemoSpec');

  // Start the game loop immediately with the demo
  gameLoop.start();
  initGame(DEMO_SPEC);

  // Load voice moment system in parallel
  await loadVoiceMomentSystem();

  // Give it the current spec
  voiceMomentSystemModule?.setSpec(DEMO_SPEC);
}

boot().catch(console.error);

// ─── Voice creation flow ───────────────────────────────────────────────────────
async function generateGame(description: string): Promise<void> {
  if (!description.trim()) return;

  state.phase = 'loading';
  loadingScreen.show('Imagining your world...');

  // Start the loading screen render loop
  let loadingRaf: number;
  let lastLoadTs = performance.now();
  const renderLoading = (ts: number) => {
    if (state.phase !== 'loading') return;
    const dt = Math.min(ts - lastLoadTs, 50);
    lastLoadTs = ts;
    loadingScreen.render(dt);
    // Scale native → display
    const dCtx = displayCanvas.getContext('2d')!;
    dCtx.imageSmoothingEnabled = false;
    dCtx.drawImage(nativeCanvas, 0, 0, 960, 540);
    loadingRaf = requestAnimationFrame(renderLoading);
  };
  loadingRaf = requestAnimationFrame(renderLoading);

  try {
    if (!llmClient.hasApiKey()) {
      // No API key — show message and play demo
      transcriptEl.textContent = 'No VITE_GEMINI_KEY — playing demo level';
      state.phase = 'gameplay';
      cancelAnimationFrame(loadingRaf);
      return;
    }

    const params = await llmClient.generateParams(description);
    loadingScreen.update('Building the world...');

    const { ProceduralGenerator } = await import('./generator/ProceduralGenerator');
    const generator = new ProceduralGenerator();
    const spec = generator.generate(params);

    loadingScreen.update('Painting the world...');
    const assetMap: AssetMap = assetGenerator.hasKey()
      ? await assetGenerator.generate(params)
      : new Map();

    state.phase = 'gameplay';
    cancelAnimationFrame(loadingRaf);
    initGame(spec);
    renderer.setAssets(assetMap);
    transcriptEl.textContent = `"${spec.meta.name}" — ${spec.meta.description}`;
  } catch (err) {
    console.error('Generation failed:', err);
    const { DEMO_SPEC } = await import('./generator/DemoSpec');
    state.phase = 'gameplay';
    cancelAnimationFrame(loadingRaf);
    transcriptEl.textContent = 'Generation failed — playing demo level';
    initGame(DEMO_SPEC);
  }
}

// ─── UI event handlers ─────────────────────────────────────────────────────────
submitBtn.addEventListener('click', () => {
  generateGame(textInput.value);
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generateGame(textInput.value);
});

micBtn.addEventListener('click', async () => {
  if (!voicePipeline.isSupported()) {
    transcriptEl.textContent = 'Voice not supported in this browser — use text input (Chrome recommended)';
    return;
  }

  micBtn.classList.add('listening');
  micBtn.textContent = '[ listening... ]';
  transcriptEl.textContent = '';

  try {
    const transcript = await voicePipeline.listen((interim) => {
      transcriptEl.textContent = interim;
    });
    micBtn.classList.remove('listening');
    micBtn.textContent = '[ mic ]';

    if (transcript) {
      textInput.value = transcript;
      transcriptEl.textContent = `"${transcript}"`;
      generateGame(transcript);
    } else {
      transcriptEl.textContent = 'No speech detected — try again or use text input';
    }
  } catch (err) {
    micBtn.classList.remove('listening');
    micBtn.textContent = '[ mic ]';
    transcriptEl.textContent = 'Mic error — use text input instead';
  }
});
