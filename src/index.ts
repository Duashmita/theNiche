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
import { VoiceMomentOverlay } from './ui/VoiceMomentOverlay';
import {
  SharedState,
  GameSpec,
  ThemeId,
  StateChange,
  GenerationParams,
  LayoutType,
  TileType,
} from './types';
import { WorldSettingsPanel } from './ui/WorldSettingsPanel';
import { ProceduralGenerator } from './generator/ProceduralGenerator';
import { ModifierDock } from './ui/ModifierDock';
import {
  pushLocalSave,
  downloadSaveJson,
  parseSaveFile,
  type GameSaveFileV1,
} from './save/gameSave';

// ─── HTML elements ─────────────────────────────────────────────────────────────
const mainMenu        = document.getElementById('main-menu') as HTMLDivElement | null;
const playRoot        = document.getElementById('play-root') as HTMLDivElement | null;
const menuCreateBtn   = document.getElementById('menu-create-btn') as HTMLButtonElement | null;
const menuLoadBtn     = document.getElementById('menu-load-btn') as HTMLButtonElement | null;
const fileLoadInput   = document.getElementById('file-load-input') as HTMLInputElement | null;
const loadingOverlay  = document.getElementById('loading-overlay') as HTMLDivElement | null;
const loadingTitleEl  = document.getElementById('loading-title') as HTMLDivElement | null;
const loadingDetailEl = document.getElementById('loading-detail') as HTMLDivElement | null;
const gameContainerEl = document.getElementById('game-container') as HTMLDivElement | null;

const displayCanvas   = document.getElementById('display-canvas') as HTMLCanvasElement;
const uiOverlay       = document.getElementById('ui-overlay') as HTMLDivElement;
const micBtn          = document.getElementById('mic-btn') as HTMLButtonElement;
const textInput       = document.getElementById('text-input') as HTMLInputElement;
const submitBtn       = document.getElementById('submit-btn') as HTMLButtonElement;
const createNewBtn    = document.getElementById('create-new-btn') as HTMLButtonElement | null;
const transcriptEl    = document.getElementById('transcript') as HTMLDivElement;

const nativeCanvas = document.createElement('canvas');
nativeCanvas.width  = 320;
nativeCanvas.height = 180;

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

const voiceMomentOverlay  = new VoiceMomentOverlay(uiOverlay, events);
const modifierDock = gameContainerEl ? new ModifierDock(gameContainerEl) : null;

let uiBrightness = 1;
/** Last params used to build the current level (for incremental Generate + save). */
let sessionGenerationParams: GenerationParams | null = null;

const state: SharedState = {
  spec:         null,
  phase:        'menu',
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

/** Apply left-panel modifier checkboxes onto params. Empty checkboxes = keep params.rules as-is. */
function applyModifierDock(params: GenerationParams): GenerationParams {
  if (!modifierDock) return params;
  const picked = modifierDock.getSelectedRules();
  const next: GenerationParams = { ...params };
  if (picked.length > 0) next.rules = picked;
  if (modifierDock.getStartInvertedGravity()) next.gravityStartsInverted = true;
  else delete next.gravityStartsInverted;
  return next;
}


function minimalGenerationParamsFromSpec(spec: GameSpec): GenerationParams {
  return {
    title: spec.meta.name,
    description: spec.meta.description,
    layout: spec.map.layout as LayoutType,
    theme: spec.theme.tileset as ThemeId,
    difficulty: spec.meta.difficulty,
    sections: [
      {
        type: 'intro',
        widthTiles: 25,
        hazardDensity: 0,
        enemyCount: 0,
        enemyArchetypes: [],
        hasCheckpoint: false,
      },
    ],
    abilities: spec.player.abilities,
    rules: spec.rules.map((r) => r.id) as GenerationParams['rules'],
    voiceMomentCount: 1,
    backgroundColor: spec.theme.backgroundColor,
    palette: spec.theme.palette,
    gameSpeed: spec.meta.gameSpeed,
    startingHealth: spec.player.health,
  };
}

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

const voiceMomentProxy = {
  update(eventsBus: EventBus, st: SharedState, tm: Tilemap, es: EntitySystem, dt: number) {
    voiceMomentSystemModule?.update(eventsBus, st, tm, es, dt);
  },
};

const gameLoop = new GameLoop(
  input, player, physics, entitySystem, rules,
  camera, renderer, juice, audio,
  events, tilemap, state,
  voiceMomentProxy,
);

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
  rules.update(state, 0);

  voiceMomentSystemModule?.setSpec(spec);

  queueMicrotask(() => {
    const os = document.getElementById('opt-game-speed') as HTMLInputElement | null;
    const ob = document.getElementById('opt-brightness') as HTMLInputElement | null;
    if (os) os.value = String(state.gameSpeed);
    if (ob) ob.value = String(uiBrightness);
  });
}

function showHtmlLoading(title: string, detail: string): void {
  if (loadingTitleEl) loadingTitleEl.textContent = title;
  if (loadingDetailEl) loadingDetailEl.textContent = detail;
  loadingOverlay?.classList.add('visible');
}

function hideHtmlLoading(): void {
  loadingOverlay?.classList.remove('visible');
}

function showMainMenu(): void {
  state.phase = 'menu';
  state.simulationPaused = true;
  mainMenu?.style.setProperty('display', 'flex');
  playRoot?.classList.remove('visible');
  modifierDock?.hide();
  hideHtmlLoading();
}

function enterPlayView(): void {
  mainMenu?.style.setProperty('display', 'none');
  playRoot?.classList.add('visible');
  state.simulationPaused = false;
}

// ─── Events ───────────────────────────────────────────────────────────────────
events.on('player_damaged_by_enemy', () => {
  player.takeDamage(events, state);
});

events.on('player_stomp_bounce', () => {
  if (player.vy > 0) player.vy = -10;
});

events.on('collectible_picked_up', () => {
  state.score += 100;
});

events.on('checkpoint_reached', () => {
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
    }).catch(() => { /* keep */ });
  }
});

events.on('boss_summon_minions', (data: any) => {
  if (!data?.entity) return;
  entitySystem.spawnMaskEnemies(data.count, data.entity.x, tilemap);
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
  setTimeout(() => {
    if (state.spec) initGame(state.spec);
  }, 1500);
});

events.on('settings_opened', () => {
  state.simulationPaused = true;
});
events.on('settings_closed', () => {
  if (state.phase === 'gameplay') state.simulationPaused = false;
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
  uiOverlay,
  events,
  (params) => {
    sessionGenerationParams = { ...params };
    const generator = new ProceduralGenerator();
    const spec = generator.generate(params);
    initGame(spec);
    settingsPanel.syncFromGenerationParams(params);
  },
);

modifierDock?.setOnLaunch(() => {
  if (!state.spec) {
    transcriptEl.textContent = 'Start or load a level first.';
    return;
  }
  const base = sessionGenerationParams
    ? { ...sessionGenerationParams }
    : minimalGenerationParamsFromSpec(state.spec);
  const tuned = applyModifierDock(base);
  sessionGenerationParams = tuned;
  const spec = new ProceduralGenerator().generate(tuned);
  initGame(spec);
  voiceMomentSystemModule?.setSpec(spec);
  settingsPanel.syncFromGenerationParams(tuned);
  transcriptEl.textContent = 'World relaunched with these modifiers (procedural only — no AI art).';
  modifierDock?.hide();
});

// ─── Options dropdown ──────────────────────────────────────────────────────────
const optionsBtn = document.getElementById('options-btn');
const optionsDropdown = document.getElementById('options-dropdown');
const menuSettingsBtn = document.getElementById('menu-settings-btn');
const menuRestartBtn = document.getElementById('menu-restart-btn');
const menuSaveBtn = document.getElementById('menu-save-btn');
const menuDownloadBtn = document.getElementById('menu-download-btn');
const menuMainBtn = document.getElementById('menu-main-btn');

function closeOptionsMenu(): void {
  if (optionsDropdown) optionsDropdown.style.display = 'none';
}

function buildSavePayload(): GameSaveFileV1 | null {
  if (!state.spec) return null;
  const generationParams =
    sessionGenerationParams ?? minimalGenerationParamsFromSpec(state.spec);
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    title: state.spec.meta.name,
    generationParams,
    gameSpec: state.spec,
  };
}

if (optionsBtn && optionsDropdown && menuSettingsBtn && menuRestartBtn) {
  optionsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    optionsBtn.blur();
    optionsDropdown.style.display = optionsDropdown.style.display === 'none' ? 'flex' : 'none';
  });

  menuSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeOptionsMenu();
    settingsPanel.toggle();
  });

  menuRestartBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeOptionsMenu();
    if (state.spec) initGame(state.spec);
  });

  menuSaveBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeOptionsMenu();
    const payload = buildSavePayload();
    if (!payload) {
      transcriptEl.textContent = 'Nothing to save yet.';
      return;
    }
    pushLocalSave(payload);
    transcriptEl.textContent = `Saved "${payload.title}" to this browser.`;
  });

  menuDownloadBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeOptionsMenu();
    const payload = buildSavePayload();
    if (!payload) {
      transcriptEl.textContent = 'Nothing to download yet.';
      return;
    }
    downloadSaveJson(payload);
    transcriptEl.textContent = `Downloaded "${payload.title}.json".`;
  });

  menuMainBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeOptionsMenu();
    showMainMenu();
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('options-container')?.contains(e.target as Node)) {
      closeOptionsMenu();
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

// ─── Minimap ───────────────────────────────────────────────────────────────────
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
if (minimapCanvas) {
  const miniCtx = minimapCanvas.getContext('2d')!;
  const renderMinimap = () => {
    requestAnimationFrame(renderMinimap);
    if (state.phase !== 'gameplay' || !state.spec) {
      miniCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
      return;
    }
    const mw = state.spec.map.width;
    const mh = state.spec.map.height;
    const tSize = state.spec.display.tileSize;
    const scaleX = minimapCanvas.width / mw;
    const scaleY = minimapCanvas.height / mh;
    miniCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    for (let r = 0; r < mh; r++) {
      for (let c = 0; c < mw; c++) {
        const tile = tilemap.getTileAt(c, r);
        if (tile === 1 || tile === 2) {
          miniCtx.fillStyle = '#5a4aaa';
          miniCtx.fillRect(c * scaleX, r * scaleY, scaleX + 0.5, scaleY + 0.5);
        } else if (tile === 3) {
          miniCtx.fillStyle = '#ff0055';
          miniCtx.fillRect(c * scaleX, r * scaleY, scaleX + 0.5, scaleY + 0.5);
        }
      }
    }
    const px = player.x / tSize;
    const py = player.y / tSize;
    miniCtx.fillStyle = '#00ffff';
    miniCtx.beginPath();
    miniCtx.arc(px * scaleX, py * scaleY, Math.max(1.5, scaleX), 0, Math.PI * 2);
    miniCtx.fill();
  };
  requestAnimationFrame(renderMinimap);
}

// ─── Start demo session (after menu) ───────────────────────────────────────────
async function startDemoSession(): Promise<void> {
  const { DEMO_SPEC } = await import('./generator/DemoSpec');
  sessionGenerationParams = null;
  modifierDock?.reset();
  modifierDock?.hide();
  settingsPanel.resetToDefaults();
  renderer.setAssets(new Map());
  textInput.value = '';
  textInput.blur();
  transcriptEl.textContent = 'Fresh demo — nothing loaded from before. Use Generate for AI worlds (and art).';
  enterPlayView();
  initGame(DEMO_SPEC);
  voiceMomentSystemModule?.setSpec(DEMO_SPEC);
  modifierDock?.peekBriefly();
}

async function loadGameFromFile(json: string): Promise<void> {
  const data = parseSaveFile(json);
  if (!data) {
    transcriptEl.textContent = 'Invalid save file.';
    return;
  }
  sessionGenerationParams = data.generationParams;
  settingsPanel.syncFromGenerationParams(data.generationParams);
  modifierDock?.reset();
  modifierDock?.hide();
  enterPlayView();
  initGame(data.gameSpec);
  voiceMomentSystemModule?.setSpec(data.gameSpec);
  transcriptEl.textContent = `Loaded "${data.title}".`;
}

// ─── LLM generation ────────────────────────────────────────────────────────────
async function runGeneration(description: string): Promise<void> {
  const trimmed = description.trim();
  if (!trimmed) {
    transcriptEl.textContent = 'Type a description first.';
    return;
  }

  if (!llmClient.hasApiKey()) {
    transcriptEl.textContent = 'Add VITE_GEMINI_KEY to use Generate.';
    return;
  }

  state.phase = 'loading';
  showHtmlLoading('Building your world', 'Talking to the designer AI…');

  try {
    let params: GenerationParams;
    if (sessionGenerationParams) {
      showHtmlLoading('Updating your world', 'Merging your request into the current design…');
      params = await llmClient.generateParamsIncremental(trimmed, sessionGenerationParams);
    } else {
      showHtmlLoading('Creating from scratch', 'Imagining layout, theme, and pacing…');
      params = await llmClient.generateParams(trimmed);
    }

    params = applyModifierDock(params);
    settingsPanel.syncFromGenerationParams(params);
    sessionGenerationParams = params;

    showHtmlLoading('Almost there', 'Placing tiles and entities…');
    const generator = new ProceduralGenerator();
    const spec = generator.generate(params);

    hideHtmlLoading();
    initGame(spec);
    voiceMomentSystemModule?.setSpec(spec);
    modifierDock?.peekBriefly();

    if (assetGenerator.hasKey()) {
      assetGenerator.generate(params, (partial) => renderer.patchAssets(partial)).catch(() => {});
    }
    transcriptEl.textContent = `"${spec.meta.name}" — ${spec.meta.description}`;
  } catch (err) {
    console.error(err);
    hideHtmlLoading();
    transcriptEl.textContent = 'Generation failed — try again or adjust your prompt.';
    const { DEMO_SPEC } = await import('./generator/DemoSpec');
    initGame(DEMO_SPEC);
  }
}

async function createNewInPlay(): Promise<void> {
  sessionGenerationParams = null;
  modifierDock?.reset();
  modifierDock?.hide();
  settingsPanel.resetToDefaults();
  renderer.setAssets(new Map());
  textInput.value = '';
  textInput.blur();
  transcriptEl.textContent = 'New session — nothing from before. Demo loaded; Generate makes a new AI world + art.';
  const { DEMO_SPEC } = await import('./generator/DemoSpec');
  initGame(DEMO_SPEC);
  voiceMomentSystemModule?.setSpec(DEMO_SPEC);
  modifierDock?.peekBriefly();
}

// ─── Boot ───────────────────────────────────────────────────────────────────────
async function boot() {
  const { DEMO_SPEC } = await import('./generator/DemoSpec');
  gameLoop.start();
  initGame(DEMO_SPEC);
  state.phase = 'menu';
  state.simulationPaused = true;
  voiceMomentSystemModule?.setSpec(DEMO_SPEC);

  await loadVoiceMomentSystem();
  voiceMomentSystemModule?.setSpec(DEMO_SPEC);
}

menuCreateBtn?.addEventListener('click', () => {
  startDemoSession().catch(console.error);
});

menuLoadBtn?.addEventListener('click', () => {
  fileLoadInput?.click();
});

fileLoadInput?.addEventListener('change', () => {
  const f = fileLoadInput.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result ?? '');
    loadGameFromFile(text).catch(console.error);
    fileLoadInput.value = '';
  };
  reader.readAsText(f);
});

submitBtn.addEventListener('click', () => {
  runGeneration(textInput.value).catch(console.error);
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runGeneration(textInput.value).catch(console.error);
});

createNewBtn?.addEventListener('click', () => {
  createNewInPlay().catch(console.error);
});

micBtn.addEventListener('click', async () => {
  if (!voicePipeline.isSupported()) {
    transcriptEl.textContent = 'Voice not supported — use text (Chrome recommended).';
    return;
  }
  micBtn.classList.add('listening');
  micBtn.textContent = 'Listening…';
  transcriptEl.textContent = '';
  try {
    const transcript = await voicePipeline.listen((interim) => {
      transcriptEl.textContent = interim;
    });
    micBtn.classList.remove('listening');
    micBtn.textContent = 'Mic';
    if (transcript) {
      textInput.value = transcript;
      await runGeneration(transcript);
    } else {
      transcriptEl.textContent = 'No speech detected.';
    }
  } catch {
    micBtn.classList.remove('listening');
    micBtn.textContent = 'Mic';
    transcriptEl.textContent = 'Mic error — use text input.';
  }
});

displayCanvas.addEventListener('click', () => {
  textInput.blur();
});

boot().catch(console.error);
