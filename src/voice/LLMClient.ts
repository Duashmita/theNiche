import { GenerationParams, VoiceMomentSpec, VoiceMomentResponse } from '../types';
import { CREATION_PROMPT, VOICE_MOMENT_PROMPT } from './PromptTemplates';

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
      2048,
      0.9,
    );

    let raw: Partial<GenerationParams>;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('Gemini returned invalid JSON for game params');
    }

    return this.validateParams(raw, description);
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
      throw new Error('Gemini returned invalid JSON for voice moment');
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

  private validateParams(p: Partial<GenerationParams>, description: string): GenerationParams {
    const lower = description.toLowerCase();

    // Layout inference
    let layout = p.layout;
    if (!layout || !['linear', 'rooms', 'arena'].includes(layout)) {
      if (/\b(arena|fight|survive|wave|defend)\b/.test(lower)) layout = 'arena';
      else if (/\b(explore|dungeon|rooms|find|discover)\b/.test(lower)) layout = 'rooms';
      else layout = 'linear';
    }

    // Theme inference
    let theme = p.theme;
    const validThemes = ['forest', 'underwater', 'space', 'city', 'dungeon', 'ice'];
    if (!theme || !validThemes.includes(theme)) {
      if (/\b(water|ocean|sea|underwater)\b/.test(lower))  theme = 'underwater';
      else if (/\b(space|stars|galaxy|planet)\b/.test(lower)) theme = 'space';
      else if (/\b(dungeon|dark|cave|crypt)\b/.test(lower))   theme = 'dungeon';
      else if (/\b(ice|snow|frozen|winter|cold)\b/.test(lower)) theme = 'ice';
      else if (/\b(city|urban|building|neon)\b/.test(lower))  theme = 'city';
      else theme = 'forest';
    }

    const difficulty = typeof p.difficulty === 'number'
      ? Math.max(0, Math.min(1, p.difficulty))
      : 0.4;

    // Sections
    let sections = p.sections;
    if (!Array.isArray(sections) || sections.length < 2) {
      sections = [
        { type: 'intro',      widthTiles: 25, hazardDensity: 0,                enemyCount: 0,                    enemyArchetypes: [],              hasCheckpoint: false },
        { type: 'challenge',  widthTiles: 35, hazardDensity: difficulty * 0.5,  enemyCount: Math.ceil(difficulty * 3), enemyArchetypes: ['patrol'],  hasCheckpoint: false },
        { type: 'checkpoint', widthTiles: 15, hazardDensity: 0,                enemyCount: 0,                    enemyArchetypes: [],              hasCheckpoint: true  },
        { type: 'challenge',  widthTiles: 40, hazardDensity: difficulty * 0.7,  enemyCount: Math.ceil(difficulty * 4), enemyArchetypes: ['patrol', 'chaser'], hasCheckpoint: false },
        { type: 'finale',     widthTiles: 30, hazardDensity: difficulty * 0.5,  enemyCount: Math.ceil(difficulty * 2), enemyArchetypes: ['chaser'],  hasCheckpoint: false },
      ];
    }

    // Abilities
    const validAbilities = ['double_jump','wall_slide','dash','wall_jump','ground_pound','glide','swim','shoot','grapple','size_change','melee'];
    let abilities = (p.abilities ?? []).filter(a => validAbilities.includes(a));
    if (!abilities.includes('double_jump')) abilities = ['double_jump', ...abilities];
    abilities = abilities.slice(0, 3);

    // Rules
    const validRules = ['gravity_flip','floor_decay','size_change','speed_boost','vision_limit','time_limit','wind','darkness','enemy_grow','mirror'];
    const rules = (p.rules ?? []).filter(r => validRules.includes(r)).slice(0, 2) as any[];

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

    return {
      title:              p.title?.slice(0, 50) || description.slice(0, 40),
      description,
      layout,
      theme,
      difficulty,
      sections,
      abilities,
      rules,
      voiceMomentCount:   typeof p.voiceMomentCount === 'number' ? Math.min(3, Math.max(1, p.voiceMomentCount)) : 2,
      backgroundColor:    p.backgroundColor || pal.bg,
      palette:            Array.isArray(p.palette) && p.palette.length >= 4 ? p.palette.slice(0, 4) : pal.palette,
    };
  }
}
