# theNiche

A voice-driven procedural platformer where you describe a world and an LLM builds it in real time. Speak into the mic mid-level to trigger world-altering voice moments.

---

## Project Structure

```
theNiche/
├── index.html                     # Full page layout: menu, game canvas (960×540), HUD, mic/text input bar
├── vite.config.ts                 # Vite build config; dev proxy to Replicate API, relative base for GitHub Pages
├── tsconfig.json                  # TypeScript compiler settings
├── package.json                   # Project metadata and dependencies (replicate, vite, typescript)
│
├── proxy/
│   ├── worker.js                  # Cloudflare Worker CORS proxy for Replicate image-generation API (production)
│   └── wrangler.toml              # Wrangler config for deploying the Worker (entry point, compatibility date)
│
└── src/
    ├── index.ts                   # Main entry point — wires all systems, handles menu flow, LLM generation, save/load
    ├── types.ts                   # Core TypeScript types: TileType, GameSpec, SharedState, GenerationParams, themes
    │
    ├── engine/
    │   ├── EventBus.ts            # Central pub-sub; decouples systems via typed events (player_jumped, enemy_killed, etc.)
    │   ├── GameLoop.ts            # 60-fps requestAnimationFrame loop; calls update on all systems in fixed order
    │   ├── InputSystem.ts         # Keyboard + gamepad polling with jump/dash/action buffering (100–150ms windows)
    │   ├── PlayerController.ts    # Mario-like player physics (coyote frames, wall-slide) + ability state machine
    │   ├── PhysicsSystem.ts       # AABB collision resolution for player on solid/hazard/trigger tiles
    │   ├── EntitySystem.ts        # Spawns and updates enemies, coins, checkpoints, NPCs from EntitySpec
    │   ├── Tilemap.ts             # Tile grid: collision queries, fired-trigger tracking, runtime tile mutation
    │   ├── RulesEngine.ts         # Instantiates and ticks active Rule implementations each frame
    │   ├── Camera.ts              # Smooth follow camera with look-ahead, vertical offset, and world-bound clamping
    │   ├── Renderer.ts            # Pixel-perfect canvas renderer: tiles, entities, particles, HUD, asset swaps
    │   ├── AudioManager.ts        # Web Audio API chiptune SFX synthesizer (jump, coin, hurt, gravity_flip, etc.)
    │   ├── JuiceSystem.ts         # Visual polish: screen shake, particles, squash-stretch tweens, freeze frames
    │   ├── AssetGenerator.ts      # Triggers Replicate image generation and swaps assets into Renderer on completion
    │   ├── PlayerProgression.ts   # XP/leveling system; awards XP on kills, scales max health/energy per level
    │   ├── EnemyDirector.ts       # Scales enemy difficulty (count, speed, aggression) from player skill rating
    │   └── CombatDirector.ts      # Tracks in-combat state based on recent hits/proximity for regen and narrative
    │
    ├── generator/
    │   ├── ProceduralGenerator.ts # Converts GenerationParams → GameSpec using linear, rooms, or arena layouts
    │   └── DemoSpec.ts            # Hand-crafted forest demo level (120×30 tiles, platforms, hazards, voice moment door)
    │
    ├── voice/
    │   ├── VoicePipeline.ts       # Web Speech API wrapper; captures mic input and resolves with final transcript
    │   ├── LLMClient.ts           # Gemini 2.5 Flash client for world creation, incremental updates, and voice interpretation
    │   ├── PromptTemplates.ts     # System prompts: CREATION_PROMPT, INCREMENTAL_PROMPT, VOICE_MOMENT_PROMPT
    │   └── VoiceMomentSystem.ts   # Full voice-moment lifecycle: listen → LLM → apply state changes → reveal door
    │
    ├── rules/
    │   ├── GravityFlip.ts         # Rule: toggles inverted gravity on every jump or checkpoint contact
    │   └── FloorDecay.ts          # Rule: removes tiles the player lands on after 800ms (crumbling platforms)
    │
    ├── save/
    │   └── gameSave.ts            # Save/load via localStorage (8-entry queue) and download-as-JSON
    │
    ├── ui/
    │   ├── VoiceMomentOverlay.ts  # HTML overlay for voice moment phases (listening, processing, reveal) with waveform
    │   ├── WorldSettingsPanel.ts  # Tab-toggleable panel for manually configuring all generation params without AI
    │   ├── LoadingScreen.ts       # Canvas loading screen with animated progress bar during LLM generation
    │   └── ModifierDock.ts        # Collapsible left-panel for chaos modifiers and gravity-inversion toggle
    │
    └── utils/
        ├── math.ts                # Clamp, lerp, distance, rect overlap, random, easing functions
        ├── tween.ts               # TweenManager for animating numeric properties with easing + callbacks
        └── mergeGenerationParams.ts # Deep-merges LLM incremental updates into existing GenerationParams
```

---

## Key Concepts

- **Voice Moments** — Trigger tiles that pause gameplay, listen for player speech, send it to the LLM, and reshape the world (spawn enemies, remove platforms, flip gravity, etc.) before unlocking a door.
- **Procedural Generator** — Three layout strategies: `linear` (side-scroll), `rooms` (Metroidvania chambers + corridors), `arena` (wave-survival enclosed space).
- **Rules** — Pluggable per-level modifiers (`gravity_flip`, `floor_decay`) registered in `RulesEngine` and updated every frame.
- **LLM Pipeline** — Gemini 2.5 Flash handles three tasks: initial world creation from a voice/text prompt, incremental tweaks mid-session, and voice-moment interpretation.

---

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Bundler | Vite |
| Rendering | Native Canvas 2D (320×180 → 960×540 pixel-perfect) |
| Audio | Web Audio API (synthesized chiptune) |
| Voice input | Web Speech API |
| LLM | Gemini 2.5 Flash |
| Image gen | Replicate (proxied via Cloudflare Worker in production) |
| Deployment | GitHub Pages + GitHub Actions |
