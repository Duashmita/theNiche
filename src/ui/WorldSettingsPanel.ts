import { GenerationParams, ThemeId, AbilityId, RuleId, LayoutType, EnemyArchetype } from '../types';
import { EventBus } from '../engine/EventBus';

// ─── WorldSettingsPanel ────────────────────────────────────────────────────────
//
// A full-screen overlay panel (Tab to open/close) that lets the player manually
// configure every knob in GenerationParams without typing a voice/text prompt.
//
// Integration in index.ts:
//
//   import { WorldSettingsPanel } from './ui/WorldSettingsPanel';
//   const settingsPanel = new WorldSettingsPanel(
//     document.getElementById('ui-overlay')!,
//     events,
//     (params) => {
//       const spec = new ProceduralGenerator().generate(params);
//       initGame(spec);
//     },
//   );
//
// The panel emits 'settings_opened' and 'settings_closed' on the event bus so
// the game loop can pause/resume input processing while the overlay is active.

type LaunchCallback = (params: GenerationParams) => void;

interface SettingsDraft {
  theme: ThemeId;
  layout: LayoutType;
  sectionCount: number;
  health: number;
  abilities: Set<AbilityId>;
  voiceMomentCount: number;
  enemyArchetypes: Set<string>;
  enemyDensity: number;       // 0-3 mapped to enemyCount per section
  difficulty: number;         // 0.0-1.0
  rules: Set<RuleId>;
}

const THEMES: Array<{ id: ThemeId; label: string }> = [
  { id: 'forest',     label: 'Overgrown forest'  },
  { id: 'underwater', label: 'Sunken ruins'       },
  { id: 'space',      label: 'Deep space'         },
  { id: 'city',       label: 'Neon city'          },
  { id: 'dungeon',    label: 'Dark dungeon'        },
  { id: 'ice',        label: 'Glacial ice'        },
];

const LAYOUTS: Array<{ id: LayoutType; label: string; sub: string }> = [
  { id: 'linear', label: 'Linear',  sub: 'Classic side-scroll'    },
  { id: 'rooms',  label: 'Rooms',   sub: 'Metroidvania exploration'},
  { id: 'arena',  label: 'Arena',   sub: 'Wave survival'           },
];

const ABILITIES: Array<{ id: AbilityId; label: string; group: string }> = [
  { id: 'double_jump',   label: 'Double jump',   group: 'Movement' },
  { id: 'wall_slide',    label: 'Wall slide',    group: 'Movement' },
  { id: 'dash',          label: 'Dash',          group: 'Movement' },
  { id: 'wall_jump',     label: 'Wall jump',     group: 'Movement' },
  { id: 'glide',         label: 'Fly (hold F)',  group: 'Movement' },
  { id: 'shoot',         label: 'Shoot (Z)',     group: 'Action'   },
  { id: 'melee',         label: 'Melee (E)',     group: 'Action'   },
  { id: 'grapple',       label: 'Grapple hook',  group: 'Action'   },
  { id: 'ground_pound',  label: 'Ground pound',  group: 'Action'   },
];

const RULES: Array<{ id: RuleId; label: string; sub: string }> = [
  { id: 'floor_decay',  label: 'Floor decay',     sub: 'Platforms crumble on contact' },
  { id: 'gravity_flip', label: 'Gravity flip',    sub: 'Jumping flips gravity'        },
  { id: 'wind',         label: 'Heavy wind',      sub: 'Horizontal push (strength in rule)' },
  { id: 'speed_boost',  label: 'Speed boost',      sub: 'Faster simulation (mult in rule)' },
  { id: 'time_limit',   label: 'Time limit',      sub: 'Default 180s unless set in spec' },
];

const SECTION_PRESETS: Array<{ label: string; count: number }> = [
  { label: 'Bite-sized',  count: 3 },
  { label: 'Standard',    count: 5 },
  { label: 'Marathon',    count: 8 },
];

const DENSITY_LABELS = ['Peaceful', 'Sparse', 'Normal', 'Swarm'];
const HEALTH_OPTIONS = [
  { label: 'Hardcore', value: 1 },
  { label: 'Standard', value: 3 },
  { label: 'Tank',     value: 5 },
];
const VOICE_OPTIONS = [
  { label: 'Silent',   value: 0 },
  { label: 'Rare',     value: 1 },
  { label: 'Standard', value: 2 },
  { label: 'Chaos',    value: 99 }, // 99 = one per section
];

export class WorldSettingsPanel {
  private container: HTMLElement;
  private el: HTMLDivElement;
  private events: EventBus;
  private onLaunch: LaunchCallback;
  private isOpen = false;

  private draft: SettingsDraft = {
    theme:             'forest',
    layout:            'linear',
    sectionCount:      5,
    health:            3,
    abilities:         new Set(['double_jump']),
    voiceMomentCount:  2,
    enemyArchetypes:   new Set(['patrol', 'chaser']),
    enemyDensity:      2,
    difficulty:        0.4,
    rules:             new Set(),
  };

  constructor(container: HTMLElement, events: EventBus, onLaunch: LaunchCallback) {
    this.container = container;
    this.events    = events;
    this.onLaunch  = onLaunch;

    this.el = document.createElement('div');
    this.el.id = 'world-settings-panel';
    this.applyPanelStyles();
    this.container.appendChild(this.el);

    // Keyboard shortcut: Tab toggles the panel
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.isOpen ? this.close() : this.open();
      }
      if (e.code === 'Escape' && this.isOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    });

    this.render();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  open(): void {
    this.isOpen = true;
    this.el.style.opacity = '1';
    this.el.style.pointerEvents = 'all';
    this.events.emit('settings_opened', {});
    this.render();
  }

  close(): void {
    this.isOpen = false;
    this.el.style.opacity = '0';
    this.el.style.pointerEvents = 'none';
    this.events.emit('settings_closed', {});
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  /** True while the overlay is visible (used so Escape can open game options instead). */
  isPanelVisible(): boolean {
    return this.isOpen;
  }

  /** Reset manual settings to defaults (Create new game — no stale rules/modifiers). */
  resetToDefaults(): void {
    this.draft = {
      theme:             'forest',
      layout:            'linear',
      sectionCount:      5,
      health:            3,
      abilities:         new Set(['double_jump']),
      voiceMomentCount:  2,
      enemyArchetypes:   new Set(['patrol', 'chaser']),
      enemyDensity:      2,
      difficulty:        0.4,
      rules:             new Set(),
    };
    if (this.isOpen) this.render();
  }

  /**
   * After text/voice generation, copy those knobs into this panel so TAB reflects
   * the same world the prompt produced (edit + LAUNCH WORLD to tweak).
   */
  syncFromGenerationParams(params: GenerationParams): void {
    this.draft.theme            = params.theme;
    this.draft.layout           = params.layout;
    this.draft.sectionCount     = Math.max(3, params.sections?.length ?? this.draft.sectionCount);
    this.draft.difficulty       = params.difficulty;
    this.draft.health           = params.startingHealth ?? this.draft.health;
    this.draft.abilities        = new Set(params.abilities ?? []);
    this.draft.rules            = new Set(params.rules ?? []);
    const vm = params.voiceMomentCount ?? 2;
    this.draft.voiceMomentCount = vm >= 99 ? 99 : Math.max(0, Math.min(3, vm));

    const arch = new Set<string>();
    for (const s of params.sections ?? []) {
      for (const a of s.enemyArchetypes ?? []) arch.add(a);
    }
    if (arch.size) this.draft.enemyArchetypes = arch;

    const counts = (params.sections ?? []).map(s => s.enemyCount);
    if (counts.length) {
      const maxC = Math.max(...counts);
      this.draft.enemyDensity = maxC <= 0 ? 0 : maxC <= 1 ? 1 : maxC <= 2 ? 2 : 3;
    }

    if (this.isOpen) this.render();
  }

  // ── Style ──────────────────────────────────────────────────────────────────

  private applyPanelStyles(): void {
    Object.assign(this.el.style, {
      position:        'absolute',
      inset:           '0',
      background:      'rgba(4, 5, 12, 0.93)',
      color:           '#e8e6f0',
      fontFamily:      "'Courier New', monospace",
      fontSize:        '12px',
      overflowY:       'auto',
      opacity:         '0',
      pointerEvents:   'none',
      transition:      'opacity 0.15s',
      zIndex:          '100',
      boxSizing:       'border-box',
      padding:         '0',
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private render(): void {
    const d = this.draft;

    this.el.innerHTML = `
      <div style="max-width:680px;margin:0 auto;padding:24px 20px 40px;">

        ${this.header()}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">
          ${this.section('World & atmosphere', `
            ${this.fieldLabel('Biome')}
            ${this.radioGrid(THEMES.map(t => ({ id: t.id, label: t.label })), 'theme', d.theme, 2)}
            ${this.fieldLabel('Level structure', '14px 0 6px')}
            ${this.layoutPicker()}
            ${this.fieldLabel('World size', '14px 0 6px')}
            ${this.segmented(SECTION_PRESETS.map(s => s.label), (() => { const i = SECTION_PRESETS.findIndex(s => s.count === d.sectionCount); return i >= 0 ? i : 1; })(), 'sectionPreset')}
          `)}
          ${this.section('Player loadout', `
            ${this.fieldLabel('Starting health')}
            ${this.segmented(HEALTH_OPTIONS.map(h => h.label), (() => { const i = HEALTH_OPTIONS.findIndex(h => h.value === d.health); return i >= 0 ? i : 1; })(), 'health')}
            ${this.fieldLabel('Abilities', '14px 0 6px')}
            <div style="font-size:10px;color:#888;margin-bottom:6px;">Movement</div>
            ${this.checkboxGroup(ABILITIES.filter(a => a.group === 'Movement'), 'ability', d.abilities)}
            <div style="font-size:10px;color:#888;margin:8px 0 6px;">Action</div>
            ${this.checkboxGroup(ABILITIES.filter(a => a.group === 'Action'), 'ability', d.abilities)}
          `)}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">
          ${this.section('Entities & mobs', `
            ${this.fieldLabel('Enemy roster')}
            ${this.checkboxGroup([
              { id: 'patrol', label: 'Goombas (patrol)' },
              { id: 'chaser', label: 'Stalkers (chaser)' },
              { id: 'flyer',  label: 'Aero (flyer)' },
              { id: 'turret', label: 'Snipers (turret)' },
            ], 'archetype', d.enemyArchetypes)}
            
            ${this.fieldLabel('Enemy density', '14px 0 6px')}
            ${this.segmented(['Peaceful', 'Sparse', 'Normal', 'Swarm'], d.enemyDensity, 'density')}
            
            ${this.fieldLabel('Coin density', '14px 0 6px')}
            ${this.segmented(['Barren', 'Balanced', 'Shower'], (d as any).coinDensity ?? 1, 'coinDensity')}
            
            ${this.fieldLabel('Difficulty', '14px 0 6px')}
            ${this.sliderRow('difficulty', d.difficulty, 0, 1, 0.05, `${Math.round(d.difficulty * 100)}%`)}
          `)}
          ${this.section('Chaos modifiers', `
            ${this.fieldLabel('Active modifiers')}
            <div style="font-size:10px;color:#888;margin-bottom:6px;">Max 2 active at once</div>
            ${RULES.map(r => this.ruleToggle(r, d.rules.has(r.id))).join('')}
          `)}
          
        </div>

        ${this.launchBar()}
      </div>
    `;

    this.attachHandlers();
  }

  // ── HTML helpers ───────────────────────────────────────────────────────────

  private header(): string {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a3a;padding-bottom:14px;">
        <div>
          <div style="font-size:15px;font-weight:500;letter-spacing:1px;">WORLD SETTINGS</div>
          <div style="font-size:10px;color:#666;margin-top:3px;">TAB to close  ·  changes apply on launch</div>
        </div>
        <button data-action="close" style="background:none;border:1px solid #333;color:#888;padding:4px 12px;cursor:pointer;font-family:inherit;font-size:11px;border-radius:3px;">ESC / close</button>
      </div>`;
  }

  private section(title: string, content: string): string {
    return `
      <div style="background:#0d0d1a;border:1px solid #1e1e2e;border-radius:6px;padding:16px;">
        <div style="font-size:10px;letter-spacing:1.5px;color:#555;margin-bottom:12px;text-transform:uppercase;">${title}</div>
        ${content}
      </div>`;
  }

  private fieldLabel(text: string, margin = '0 0 6px'): string {
    return `<div style="font-size:11px;color:#aaa;margin:${margin};">${text}</div>`;
  }

  private radioGrid(
    items: Array<{ id: string; label: string }>,
    group: string,
    selected: string,
    cols: number,
  ): string {
    return `
      <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;">
        ${items.map(item => `
          <label data-group="${group}" data-value="${item.id}" style="
            display:flex;align-items:center;gap:6px;
            padding:6px 8px;border-radius:4px;cursor:pointer;
            border:1px solid ${item.id === selected ? '#5a4aaa' : '#1e1e2e'};
            background:${item.id === selected ? '#1e1a3a' : 'transparent'};
            font-size:11px;color:${item.id === selected ? '#c4baff' : '#999'};
            transition:all 0.1s;
          ">
            <span style="
              width:8px;height:8px;border-radius:50%;flex-shrink:0;
              background:${item.id === selected ? '#7f77dd' : '#333'};
              border:1px solid ${item.id === selected ? '#7f77dd' : '#444'};
            "></span>
            ${item.label}
          </label>
        `).join('')}
      </div>`;
  }

  private layoutPicker(): string {
    return `
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${LAYOUTS.map(l => `
          <label data-group="layout" data-value="${l.id}" style="
            display:flex;align-items:center;justify-content:space-between;
            padding:7px 10px;border-radius:4px;cursor:pointer;
            border:1px solid ${l.id === this.draft.layout ? '#5a4aaa' : '#1e1e2e'};
            background:${l.id === this.draft.layout ? '#1e1a3a' : 'transparent'};
            transition:all 0.1s;
          ">
            <span style="font-size:11px;color:${l.id === this.draft.layout ? '#c4baff' : '#aaa'};">${l.label}</span>
            <span style="font-size:10px;color:#555;">${l.sub}</span>
          </label>
        `).join('')}
      </div>`;
  }

  private segmented(labels: string[], selectedIdx: number, key: string): string {
    return `
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        ${labels.map((label, i) => `
          <button data-seg="${key}" data-idx="${i}" style="
            flex:1;min-width:60px;padding:5px 8px;border-radius:3px;cursor:pointer;
            font-family:inherit;font-size:10px;letter-spacing:0.5px;
            background:${i === selectedIdx ? '#2a2050' : 'transparent'};
            border:1px solid ${i === selectedIdx ? '#5a4aaa' : '#2a2a3a'};
            color:${i === selectedIdx ? '#c4baff' : '#666'};
            transition:all 0.1s;
          ">${label}</button>
        `).join('')}
      </div>`;
  }

  private checkboxGroup(
    items: Array<{ id: string; label: string }>,
    groupKey: string,
    selected: Set<string>,
  ): string {
    return `
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${items.map(item => `
          <label data-cb-group="${groupKey}" data-cb-value="${item.id}" style="
            display:flex;align-items:center;gap:8px;cursor:pointer;
            padding:4px 6px;border-radius:3px;
            background:${selected.has(item.id) ? '#1a1530' : 'transparent'};
          ">
            <span style="
              width:12px;height:12px;border-radius:2px;flex-shrink:0;
              background:${selected.has(item.id) ? '#7f77dd' : 'transparent'};
              border:1px solid ${selected.has(item.id) ? '#7f77dd' : '#333'};
              display:flex;align-items:center;justify-content:center;
            ">${selected.has(item.id) ? '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>' : ''}</span>
            <span style="font-size:11px;color:${selected.has(item.id) ? '#c4baff' : '#888'};">${item.label}</span>
          </label>
        `).join('')}
      </div>`;
  }

  private ruleToggle(rule: { id: RuleId; label: string; sub: string }, active: boolean): string {
    return `
      <div data-rule-toggle="${rule.id}" style="
        display:flex;align-items:center;justify-content:space-between;
        padding:8px 10px;margin-bottom:6px;border-radius:4px;cursor:pointer;
        border:1px solid ${active ? '#5a4aaa' : '#1e1e2e'};
        background:${active ? '#1a1530' : 'transparent'};
        transition:all 0.1s;
      ">
        <div>
          <div style="font-size:11px;color:${active ? '#c4baff' : '#aaa'};">${rule.label}</div>
          <div style="font-size:10px;color:#555;margin-top:2px;">${rule.sub}</div>
        </div>
        <div style="
          width:28px;height:16px;border-radius:8px;flex-shrink:0;
          background:${active ? '#7f77dd' : '#2a2a3a'};
          position:relative;transition:background 0.15s;
        ">
          <div style="
            position:absolute;top:2px;left:${active ? '12px' : '2px'};
            width:12px;height:12px;border-radius:50%;
            background:#fff;transition:left 0.15s;
          "></div>
        </div>
      </div>`;
  }

  private sliderRow(key: string, value: number, min: number, max: number, step: number, display: string): string {
    return `
      <div style="display:flex;align-items:center;gap:10px;">
        <input
          type="range" data-slider="${key}"
          min="${min}" max="${max}" step="${step}" value="${value}"
          style="flex:1;accent-color:#7f77dd;"
        />
        <span style="font-size:11px;color:#c4baff;min-width:32px;text-align:right;">${display}</span>
      </div>`;
  }

  private launchBar(): string {
    const abilityCount  = this.draft.abilities.size;
    const ruleCount     = this.draft.rules.size;
    const themeName     = THEMES.find(t => t.id === this.draft.theme)?.label ?? this.draft.theme;
    const layoutName    = LAYOUTS.find(l => l.id === this.draft.layout)?.label ?? this.draft.layout;

    return `
      <div style="
        margin-top:24px;padding:16px;
        border:1px solid #1e1e2e;border-radius:6px;
        display:flex;align-items:center;justify-content:space-between;gap:16px;
        background:#080812;
      ">
        <div style="font-size:11px;color:#555;line-height:1.8;">
          <span style="color:#7f77dd;">${themeName}</span> ·
          <span style="color:#7f77dd;">${layoutName}</span> ·
          ${this.draft.sectionCount} sections ·
          ${abilityCount} abilit${abilityCount === 1 ? 'y' : 'ies'} ·
          ${ruleCount} modifier${ruleCount === 1 ? '' : 's'}
        </div>
        <button data-action="launch" style="
          background:#3a2d8a;border:1px solid #7f77dd;color:#c4baff;
          padding:10px 28px;cursor:pointer;
          font-family:inherit;font-size:12px;letter-spacing:1px;
          border-radius:4px;white-space:nowrap;
          transition:background 0.1s;
        ">LAUNCH WORLD</button>
      </div>`;
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

private attachHandlers(): void {
    // Close button
    this.el.querySelector('[data-action="close"]')?.addEventListener('click', (e) => {
      (e.target as HTMLElement).blur(); // FIX SPACEBAR BUG
      this.close();
    });

    // Launch button
    this.el.querySelector('[data-action="launch"]')?.addEventListener('click', (e) => {
      (e.target as HTMLElement).blur(); // FIX SPACEBAR BUG
      this.close();
      this.onLaunch(this.buildParams());
    });

    // Radio groups
    this.el.querySelectorAll<HTMLElement>('[data-group]').forEach(el => {
      el.addEventListener('click', () => {
        const group = el.dataset.group as string;
        const value = el.dataset.value as string;
        if (group === 'theme') this.draft.theme = value as ThemeId;
        else if (group === 'layout') this.draft.layout = value as LayoutType;
        this.render();
      });
    });

    // Segmented controls
    this.el.querySelectorAll<HTMLElement>('[data-seg]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.seg!;
        const idx = parseInt(el.dataset.idx!, 10);
        if (key === 'sectionPreset') this.draft.sectionCount = [3, 5, 8][idx];
        else if (key === 'health') this.draft.health = [1, 3, 5][idx];
        else if (key === 'voiceFreq') this.draft.voiceMomentCount = [0, 1, 2, 99][idx];
        else if (key === 'density') this.draft.enemyDensity = idx;
        else if (key === 'coinDensity') (this.draft as any).coinDensity = idx; // NEW COIN SETTING
        this.render();
      });
    });

    // Checkboxes
    this.el.querySelectorAll<HTMLElement>('[data-cb-group]').forEach(el => {
      el.addEventListener('click', () => {
        const group = el.dataset.cbGroup!;
        const value = el.dataset.cbValue!;
        
        if (group === 'ability') {
          if (this.draft.abilities.has(value as any)) this.draft.abilities.delete(value as any);
          else this.draft.abilities.add(value as any);
        } 
        else if (group === 'archetype') {
          if (this.draft.enemyArchetypes.has(value)) this.draft.enemyArchetypes.delete(value);
          else this.draft.enemyArchetypes.add(value);
        }
        this.render();
      });
    });

    // Rule toggles
    this.el.querySelectorAll<HTMLElement>('[data-rule-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.ruleToggle as RuleId;
        if (this.draft.rules.has(id)) this.draft.rules.delete(id);
        else this.draft.rules.add(id);
        this.render();
      });
    });

    // Difficulty slider
    const diffSlider = this.el.querySelector<HTMLInputElement>('[data-slider="difficulty"]');
    if (diffSlider) {
      diffSlider.addEventListener('input', () => {
        this.draft.difficulty = parseFloat(diffSlider.value);
        const display = this.el.querySelector<HTMLSpanElement>('[data-slider="difficulty"] + span');
        if (display) display.textContent = `${Math.round(this.draft.difficulty * 100)}%`;
      });
    }

  }

  // ── Build GenerationParams from draft ──────────────────────────────────────

  private buildParams(): GenerationParams {
    const d = this.draft;
    const enemiesPerSection = [0, 1, 2, 4][d.enemyDensity] ?? 2;
    const archetypes = Array.from(d.enemyArchetypes) as EnemyArchetype[];

    // Build sections based on count and layout
    const sections = this.buildSections(d.sectionCount, d.difficulty, enemiesPerSection, archetypes);

    // Derive palette from theme
    const PALETTES: Record<ThemeId, string[]> = {
      forest:     ['#4a8a2c', '#2d5a1b', '#8acc44', '#ffcc44'],
      dungeon:    ['#5a5a7c', '#3a3a5c', '#8888aa', '#ffdd66'],
      space:      ['#0a1628', '#1a3a6a', '#3d6aaa', '#66ccff', '#aaccff', '#ffe94a'],
      underwater: ['#042030', '#0a5070', '#1a90b0', '#40e0d0', '#6a5acd', '#ffd060'],
      city:       ['#2a0a4a', '#ff00aa', '#00f5ff', '#39ff14', '#ffee00', '#aa00ff'],
      ice:        ['#6aaabf', '#3a6a8a', '#aaddee', '#ffe066'],
    };
    const BG: Record<ThemeId, string> = {
      forest: '#0d1b0d', dungeon: '#0d0d14', space: '#020208',
      underwater: '#021018', city: '#060210', ice: '#080f1a',
    };

    const voiceMomentCount = d.voiceMomentCount === 99
      ? sections.length
      : d.voiceMomentCount;

    return {
      title:             `Custom world`,
      description:       `Manually configured ${d.layout} level`,
      layout:            d.layout,
      theme:             d.theme,
      difficulty:        d.difficulty,
      sections,
      abilities:         Array.from(d.abilities),
      rules:             Array.from(d.rules),
      voiceMomentCount,
      backgroundColor:   BG[d.theme],
      palette:           PALETTES[d.theme],
      startingHealth:    d.health,
    };
  }

  private buildSections(
    count: number,
    difficulty: number,
    enemiesPerSection: number,
    archetypes: EnemyArchetype[],
  ) {
    const sections = [];
    const challengeCount = Math.max(1, count - 2); // minus intro and finale

    // Intro
    sections.push({
      type: 'intro' as const,
      widthTiles: 25,
      hazardDensity: 0,
      enemyCount: 0,
      enemyArchetypes: [],
      hasCheckpoint: false,
    });

    // Middle sections: alternate challenge / checkpoint
    for (let i = 0; i < challengeCount; i++) {
      const isCheckpoint = i > 0 && i % 2 === 0;
      if (isCheckpoint) {
        sections.push({
          type: 'checkpoint' as const,
          widthTiles: 15,
          hazardDensity: 0,
          enemyCount: 0,
          enemyArchetypes: [],
          hasCheckpoint: true,
        });
      } else {
        sections.push({
          type: 'challenge' as const,
          widthTiles: 35,
          hazardDensity: Math.min(0.3 + difficulty * 0.6, 0.9),
          enemyCount: enemiesPerSection,
          enemyArchetypes: archetypes,
          hasCheckpoint: false,
        });
      }
    }

    // Finale
    sections.push({
      type: 'finale' as const,
      widthTiles: 30,
      hazardDensity: Math.min(difficulty * 0.7, 0.8),
      enemyCount: Math.ceil(enemiesPerSection * 1.5),
      enemyArchetypes: archetypes,
      hasCheckpoint: false,
    });

    return sections;
  }
}