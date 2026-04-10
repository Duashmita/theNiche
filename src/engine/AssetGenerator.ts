import { AssetMap, AssetType, GenerationParams, ThemeId } from '../types';

const ASSET_TYPES: AssetType[] = [
  'ground', 'platform', 'hazard', 'decoration',
  'player', 'enemy_patrol', 'enemy_flyer', 'coin',
];

const TYPE_PROMPTS: Record<AssetType, string> = {
  ground:       'solid ground block, stone or earth texture, tileable surface',
  platform:     'floating platform, single wooden plank, thin ledge',
  hazard:       'danger tile, sharp spikes pointing up, vivid warning color, deadly',
  decoration:   'background atmospheric prop, subtle detail, no collision',
  player:       'hero character sprite, upright idle pose, small humanoid',
  enemy_patrol: 'ground enemy, crab or goblin shape, facing right, menacing creature',
  enemy_flyer:  'flying enemy, bat or drone silhouette, wings spread',
  coin:         'collectible coin or gem, glowing, shiny, pickup item',
};

const IMAGEN_URL = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict';

export class AssetGenerator {
  constructor(private readonly apiKey: string) {}

  hasKey(): boolean {
    return this.apiKey.length > 10;
  }

  async generate(params: GenerationParams): Promise<AssetMap> {
    const results = await Promise.allSettled(
      ASSET_TYPES.map(type => this.generateOne(type, params.theme, params.description, params.palette)),
    );
    const map: AssetMap = new Map();
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        map.set(`${params.theme}/${ASSET_TYPES[i]}`, result.value);
      }
    });
    return map;
  }

  async regenerateTerrain(themeId: ThemeId, palette: string[], description = ''): Promise<AssetMap> {
    const terrainTypes: AssetType[] = ['ground', 'platform', 'hazard'];
    const results = await Promise.allSettled(
      terrainTypes.map(type => this.generateOne(type, themeId, description, palette)),
    );
    const map: AssetMap = new Map();
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        map.set(`${themeId}/${terrainTypes[i]}`, result.value);
      }
    });
    return map;
  }

  private async generateOne(
    type: AssetType,
    themeId: ThemeId,
    description: string,
    palette: string[],
  ): Promise<HTMLImageElement | null> {
    try {
      const prompt = this.buildPrompt(type, themeId, description, palette);
      const res = await fetch(`${IMAGEN_URL}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const b64: string | undefined = data?.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) return null;

      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
      });
      return img;
    } catch {
      return null;
    }
  }

  private buildPrompt(
    type: AssetType,
    themeId: ThemeId,
    description: string,
    palette: string[],
  ): string {
    const colors = palette.slice(0, 3).join(' ');
    const typeDesc = TYPE_PROMPTS[type];
    const context = description ? `, ${description}` : '';
    return (
      `pixel art game sprite, ${themeId} theme${context}, ${typeDesc}, ` +
      `dominant colors ${colors}, 16x16 pixel art style, retro platformer, ` +
      `clean pixel edges, dark background, no text, no ui elements`
    );
  }
}
