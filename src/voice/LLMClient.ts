import { GenerationParams, RuleId, VoiceMomentSpec, VoiceMomentResponse } from '../types';
import { CREATION_PROMPT, INCREMENTAL_PROMPT, VOICE_MOMENT_PROMPT } from './PromptTemplates';

const MODEL   = 'gemini-2.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export class LLMClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey.trim();
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 10;
  }

  // ─── Phase 1: Generate game params from voice description ─────────────────

  async generateParams(description: string): Promise<GenerationParams> {
    if (!this.hasApiKey()) throw new Error('No API key configured');

    const text = await this.callGemini(
      CREATION_PROMPT + '\n\nPlayer description: "' + description + '"',
      4096,
      0.9,
    );

    let raw: Partial<GenerationParams> = {};
    try {
      raw = JSON.parse(text);
    } catch {
      // Non-fatal: validateParams fills in all missing fields with sensible defaults
      console.warn('Gemini returned non-JSON for game params — using defaults. Raw:', text.slice(0, 400));
    }

    return this.validateParams(raw, description, { inferThemeLayout: true });
  }

  /** Merge a small user request into existing params (Generate button after first world exists). */
  async generateParamsIncremental(
    userRequest: string,
    current: GenerationParams,
  ): Promise<GenerationParams> {
    if (!this.hasApiKey()) throw new Error('No API key configured');

    const payload = [
      INCREMENTAL_PROMPT,
      '',
      'currentParams:',
      JSON.stringify(current),
      '',
      `userRequest: "${userRequest}"`,
    ].join('\n');

    const text = await this.callGemini(payload, 4096, 0.65);

    let raw: Partial<GenerationParams> = {};
    try {
      raw = JSON.parse(text);
    } catch {
      console.warn('Gemini merge returned non-JSON — keeping previous params. Raw:', text.slice(0, 400));
      return current;
    }

    return this.validateParams(raw, userRequest, {
      inferThemeLayout: false,
      mergeBase: current,
    });
  }

  // ─── Phase 3: Process voice moment transcript ─────────────────────────────

  async processVoiceMoment(
    transcript: string,
    moment: VoiceMomentSpec,
    gameContext: string,
  ): Promise<VoiceMomentResponse> {
    if (!this.hasApiKey()) throw new Error('No API key configured');

    const prompt = [
      VOICE_MOMENT_PROMPT,
      '',
      `Voice moment ID: ${moment.id}`,
      `Player said: "${transcript || '(silence)'}"`,
      `This moment maps to: ${moment.mapsTo.join(', ')}`,
      `Game context: ${gameContext}`,
    ].join('\n');

    const text = await this.callGemini(prompt, 512, 0.85);

    let response: VoiceMomentResponse;
    try {
      response = JSON.parse(text);
    } catch {
      console.warn('Gemini returned non-JSON for voice moment — using empty response. Raw:', text.slice(0, 200));
      response = { voiceMomentId: moment.id, interpretation: '', stateChanges: [] };
    }

    // Ensure voiceMomentId matches
    response.voiceMomentId = moment.id;
    if (!Array.isArray(response.stateChanges)) response.stateChanges = [];

    return response;
  }

  // ─── Core API call ────────────────────────────────────────────────────────

  private async callGemini(
    prompt: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature,
        maxOutputTokens: maxTokens,
      },
    };

    const res = await fetch(`${API_URL}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      console.error('Gemini full response:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from Gemini');
    }
    // Strip markdown code fences if present (gemini-2.5 sometimes adds them)
    const text = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    return text;
  }

  // ─── Validation + fallback ────────────────────────────────────────────────

  private validateParams(
    p: Partial<GenerationParams>,
    description: string,
    opts: { inferThemeLayout: boolean; mergeBase?: GenerationParams },
  ): GenerationParams {
    const b = opts.mergeBase;
    const lower = description.toLowerCase();

    // Layout
    let layout = p.layout;
    if (!layout || !['linear', 'rooms', 'arena'].includes(layout)) {
      if (b && !opts.inferThemeLayout) layout = b.layout;
      else if (opts.inferThemeLayout) {
        if (/\b(arena|fight|survive|wave|defend)\b/.test(lower)) layout = 'arena';
        else if (/\b(explore|dungeon|rooms|find|discover)\b/.test(lower)) layout = 'rooms';
        else layout = 'linear';
      } else layout = 'linear';
    }

    // Theme
    let theme = p.theme;
    const validThemes = ['forest', 'underwater', 'space', 'city', 'dungeon', 'ice'];
    if (!theme || !validThemes.includes(theme)) {
      if (b && !opts.inferThemeLayout) theme = b.theme;
      else if (opts.inferThemeLayout) {
        if (/\b(water|ocean|sea|underwater)\b/.test(lower))  theme = 'underwater';
        else if (/\b(space|stars|galaxy|planet)\b/.test(lower)) theme = 'space';
        else if (/\b(dungeon|dark|cave|crypt)\b/.test(lower))   theme = 'dungeon';
        else if (/\b(ice|snow|frozen|winter|cold)\b/.test(lower)) theme = 'ice';
        else if (/\b(city|urban|building|neon)\b/.test(lower))  theme = 'city';
        else theme = 'forest';
      } else theme = 'forest';
    }

    const difficulty = typeof p.difficulty === 'number'
      ? Math.max(0, Math.min(1, p.difficulty))
      : typeof b?.difficulty === 'number'
        ? b.difficulty
        : 0.4;

    // Sections
    let sections = p.sections;
    if (!Array.isArray(sections) || sections.length < 2) {
      sections = b?.sections ?? [
        { type: 'intro',      widthTiles: 25, hazardDensity: 0,                enemyCount: 0,                    enemyArchetypes: [],              hasCheckpoint: false },
        { type: 'challenge',  widthTiles: 35, hazardDensity: difficulty * 0.5,  enemyCount: Math.ceil(difficulty * 3), enemyArchetypes: ['patrol'],  hasCheckpoint: false },
        { type: 'checkpoint', widthTiles: 15, hazardDensity: 0,                enemyCount: 0,                    enemyArchetypes: [],              hasCheckpoint: true  },
        { type: 'challenge',  widthTiles: 40, hazardDensity: difficulty * 0.7,  enemyCount: Math.ceil(difficulty * 4), enemyArchetypes: ['patrol', 'chaser'], hasCheckpoint: false },
        { type: 'finale',     widthTiles: 30, hazardDensity: difficulty * 0.5,  enemyCount: Math.ceil(difficulty * 2), enemyArchetypes: ['chaser'],  hasCheckpoint: false },
      ];
    }

    // Abilities
    const validAbilities = ['double_jump','wall_slide','dash','wall_jump','ground_pound','glide','swim','shoot','grapple','size_change','melee'];
    let abilities = (p.abilities ?? b?.abilities ?? []).filter(a => validAbilities.includes(a));
    if (!abilities.includes('double_jump')) abilities = ['double_jump', ...abilities];
    if (!abilities.includes('shoot'))       abilities = [...abilities, 'shoot'];
    abilities = abilities.slice(0, 4);

    // Rules: model only; UI toggles applied later
    const validRules = ['gravity_flip','floor_decay','size_change','speed_boost','vision_limit','time_limit','wind','darkness','enemy_grow','mirror'];
    const rawRules = p.rules ?? b?.rules ?? [];
    const rules = rawRules.filter(r => validRules.includes(r)).filter((r, i, a) => a.indexOf(r) === i).slice(0, 2) as RuleId[];

    const gp = p as { gravityStartsInverted?: boolean };
    const gravityStartsInverted = typeof gp.gravityStartsInverted === 'boolean'
      ? gp.gravityStartsInverted
      : !!b?.gravityStartsInverted;

    // Palette
    const PALETTES: Record<string, { bg: string; palette: string[] }> = {
      forest:     { bg: '#0d1b0d', palette: ['#4a8a2c', '#2d5a1b', '#8acc44', '#ffcc44'] },
      dungeon:    { bg: '#0d0d14', palette: ['#5a5a7c', '#3a3a5c', '#8888aa', '#ffdd66'] },
      space:      { bg: '#03030a', palette: ['#2a4a6a', '#1a2a3a', '#4a8aaa', '#ffee55'] },
      underwater: { bg: '#041020', palette: ['#1a6a8a', '#0a3a5a', '#44aacc', '#ffdd44'] },
      city:       { bg: '#0a0a14', palette: ['#4a4a5a', '#2a2a3a', '#7a7a8a', '#ffcc33'] },
      ice:        { bg: '#080f1a', palette: ['#6aaabf', '#3a6a8a', '#aaddee', '#ffe066'] },
    };
    const pal = PALETTES[theme] ?? PALETTES.forest;

    const descOut = (typeof p.description === 'string' && p.description.length ? p.description : null)
      ?? b?.description
      ?? description;

    const voiceMomentCount = typeof p.voiceMomentCount === 'number'
      ? Math.min(99, Math.max(0, p.voiceMomentCount))
      : typeof b?.voiceMomentCount === 'number'
        ? b.voiceMomentCount
        : 2;

    const assetDescriptions = {
      ...(b?.assetDescriptions ?? {}),
      ...((typeof p.assetDescriptions === 'object' && p.assetDescriptions !== null)
        ? p.assetDescriptions as Record<string, string>
        : {}),
    };

    return {
      title:              (p.title?.slice(0, 50) || b?.title || description.slice(0, 40)),
      description:        descOut,
      layout,
      theme,
      difficulty,
      sections,
      abilities,
      rules,
      voiceMomentCount,
      backgroundColor:    p.backgroundColor || b?.backgroundColor || pal.bg,
      palette:            Array.isArray(p.palette) && p.palette.length >= 4 ? p.palette.slice(0, 4) : (b?.palette ?? pal.palette),
      assetDescriptions,
      startingHealth:       p.startingHealth ?? b?.startingHealth,
      gameSpeed:            p.gameSpeed ?? b?.gameSpeed,
      ...(gravityStartsInverted ? { gravityStartsInverted: true } : {}),
    };
  }
}
