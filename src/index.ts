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
import { SharedState, GameSpec, ThemeId, StateChange, AssetMap, TileType } from './types';
import { WorldSettingsPanel } from './ui/WorldSettingsPanel';
import { ProceduralGenerator } from './generator/ProceduralGenerator';

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
let uiBrightness = 1;

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
  gameSpeed:    1,
  simulationPaused: false,
  screenBrightness: 1,
  windX: 0,
  ruleSpeedMult: 1,
  timeRemainingMs: null,
  ruleBrightnessFactor: 1,
};

function applyRuleDerivedState(spec: GameSpec): void {
  state.windX = 0;
  state.ruleSpeedMult = 1;
  state.timeRemainingMs = null;
  state.ruleBrightnessFactor = 1;

  for (const r of spec.rules) {
    if (r.id === 'wind') {
      state.windX = Number((r.params as { strength?: number }).strength ?? 0.14) * 5.5;
    }
    if (r.id === 'speed_boost') {
      state.ruleSpeedMult = Number((r.params as { mult?: number }).mult ?? 1.2);
    }
    if (r.id === 'vision_limit' || r.id === 'darkness') {
      state.ruleBrightnessFactor = Number((r.params as { brightness?: number }).brightness ?? 0.72);
    }
    if (r.id === 'time_limit') {
      const sec = Number((r.params as { seconds?: number }).seconds ?? 180);
      state.timeRemainingMs = sec * 1000;
    }
  }

  state.screenBrightness = Math.min(1.5, Math.max(0.3, uiBrightness * state.ruleBrightnessFactor));
}

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
  state.gameSpeed    = spec.meta.gameSpeed ?? 1;
  state.triggeredTiles.clear();
  state.simulationPaused = false;

  applyRuleDerivedState(spec);

  tilemap.init(spec);
  player.initFromSpec(spec.player, spec.map.spawnPoint.x, spec.map.spawnPoint.y, spec.display.tileSize);
  entitySystem.init(spec.entities);
  rules.init(spec.rules, tilemap);

  // Give voice moment system the new spec
  voiceMomentSystemModule?.setSpec(spec);

  queueMicrotask(() => {
    const os = document.getElementById('opt-game-speed') as HTMLInputElement | null;
    const ob = document.getElementById('opt-brightness') as HTMLInputElement | null;
    if (os) os.value = String(state.gameSpeed);
    if (ob) ob.value = String(uiBrightness);
  });
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

events.on('boss_summon_minions', (data: any) => {
  if (!data?.entity) return;
  const bossX = data.entity.x;
  entitySystem.spawnMaskEnemies(data.count, bossX, tilemap);
});

events.on('boss_slam_landed', (data: any) => {
  if (!data?.entity) return;
  juice.spawnParticles(
    data.entity.x + data.entity.width  / 2,
    data.entity.y + data.entity.height,
    { count: 16, colors: ['#ff4422', '#ff8844', '#ffffff'], speed: 4, spread: 160, gravity: 0.3, lifetime: 400, size: 3 },
  );
  juice.shakeIntensity = 10;
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

events.on('settings_opened', () => {
  state.simulationPaused = true;
});
events.on('settings_closed', () => {
  state.simulationPaused = false;
});

events.on('player_ground_pound_land', () => {
  juice.shakeIntensity = 18;
  const ts = tilemap.tileSize;
  const bottom = player.y + player.height;
  const row = Math.floor(bottom / ts);
  for (let c = Math.floor(player.x / ts) - 1; c <= Math.ceil((player.x + player.width) / ts) + 1; c++) {
    const t = tilemap.getTileAt(c, row);
    if (t === TileType.GROUND || t === TileType.PLATFORM) {
      tilemap.setTile(c, row, TileType.AIR);
    }
  }
  for (const e of entitySystem.entities) {
    if (e.type !== 'enemy' || !e.active) continue;
    if (
      e.y >= player.y - 4 &&
      e.y <= player.y + player.height + 20 &&
      e.x + e.width >= player.x - 20 &&
      e.x <= player.x + player.width + 20
    ) {
      e.health -= 2;
      if (e.health <= 0) e.active = false;
    }
  }
});

const settingsPanel = new WorldSettingsPanel(
  document.getElementById('ui-overlay') as HTMLElement,
  events,
  (params) => {
    const generator = new ProceduralGenerator();
    const spec = generator.generate(params);
    initGame(spec);
  }
);

// ── UI Overlay Logic: Dropdown & Minimap ──
const optionsBtn = document.getElementById('options-btn');
const optionsDropdown = document.getElementById('options-dropdown');
const menuSettingsBtn = document.getElementById('menu-settings-btn');
const menuRestartBtn = document.getElementById('menu-restart-btn');

if (optionsBtn && optionsDropdown && menuSettingsBtn && menuRestartBtn) {
  // Toggle dropdown
  optionsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    optionsBtn.blur();
    optionsDropdown.style.display = optionsDropdown.style.display === 'none' ? 'flex' : 'none';
  });

  // Settings clicked
  menuSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    optionsDropdown.style.display = 'none'; // close menu
    settingsPanel.toggle(); 
  });

  // Restart clicked
  menuRestartBtn.addEventListener('click', (e) => {
    e.preventDefault();
    optionsDropdown.style.display = 'none'; // close menu
    if (state.spec) initGame(state.spec);
  });

  // Close dropdown if clicking anywhere else on the screen
  document.addEventListener('click', (e) => {
    if (!document.getElementById('options-container')?.contains(e.target as Node)) {
      optionsDropdown.style.display = 'none';
    }
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (settingsPanel.isPanelVisible()) return;
    e.preventDefault();
    optionsDropdown.style.display = optionsDropdown.style.display === 'none' ? 'flex' : 'none';
  });

  const optSpeed = document.getElementById('opt-game-speed') as HTMLInputElement | null;
  const optBright = document.getElementById('opt-brightness') as HTMLInputElement | null;
  optSpeed?.addEventListener('input', () => {
    state.gameSpeed = parseFloat(optSpeed.value);
  });
  optBright?.addEventListener('input', () => {
    uiBrightness = parseFloat(optBright.value);
    if (state.spec) applyRuleDerivedState(state.spec);
    else state.screenBrightness = Math.min(1.5, Math.max(0.3, uiBrightness));
  });
}

// ── Minimap Render Loop ──
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
if (minimapCanvas) {
  const miniCtx = minimapCanvas.getContext('2d')!;

  const renderMinimap = () => {
    requestAnimationFrame(renderMinimap);
    
    // Only draw if we are actively in gameplay
    if (state.phase !== 'gameplay' || !state.spec) {
      miniCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
      return;
    }

    const mw = state.spec.map.width;
    const mh = state.spec.map.height;
    const tSize = state.spec.display.tileSize;
    
    // Calculate how much to shrink the map to fit inside the 200x60 canvas
    const scaleX = minimapCanvas.width / mw;
    const scaleY = minimapCanvas.height / mh;
    
    miniCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    // 1. Draw Terrain
    for (let r = 0; r < mh; r++) {
      for (let c = 0; c < mw; c++) {
        const tile = tilemap.getTileAt(c, r);
        if (tile === 1 || tile === 2) { 
          miniCtx.fillStyle = '#5a4aaa'; // Ground/Platform
          miniCtx.fillRect(c * scaleX, r * scaleY, scaleX + 0.5, scaleY + 0.5);
        } else if (tile === 3) { 
          miniCtx.fillStyle = '#ff0055'; // Red Hazard Pits
          miniCtx.fillRect(c * scaleX, r * scaleY, scaleX + 0.5, scaleY + 0.5);
        }
      }
    }
    
    // 2. Draw Player Dot
    const px = player.x / tSize;
    const py = player.y / tSize;
    miniCtx.fillStyle = '#00ffff'; // Glowing Cyan
    miniCtx.beginPath();
    miniCtx.arc(px * scaleX, py * scaleY, Math.max(1.5, scaleX), 0, Math.PI * 2);
    miniCtx.fill();
  };
  
  // Start the minimap loop
  requestAnimationFrame(renderMinimap);
}

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

    const generator = new ProceduralGenerator();
    const spec = generator.generate(params);

    // Start game immediately — assets stream in behind the scenes
    state.phase = 'gameplay';
    cancelAnimationFrame(loadingRaf);
    initGame(spec);

    // Fire asset generation without blocking; patch renderer as each image arrives
    if (assetGenerator.hasKey()) {
      assetGenerator.generate(params, (partial) => renderer.patchAssets(partial))
        .catch(() => { /* silent — game already running with procedural fallback */ });
    }
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
