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

// Proxied through Vite dev server to avoid CORS — see vite.config.ts server.proxy
const REPLICATE_URL = '/api/replicate/v1/models/black-forest-labs/flux-1.1-pro/predictions';

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
      const res = await fetch(REPLICATE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait',
        },
        body: JSON.stringify({
          input: {
            prompt,
            aspect_ratio: '1:1',
            output_format: 'png',
            output_quality: 80,
          },
        }),
      });
      if (!res.ok) {
        console.warn(`Image gen ${type} failed: ${res.status}`, await res.text().catch(() => ''));
        return null;
      }
      const prediction = await res.json();
      const outputUrl: string | undefined = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
      if (!outputUrl) return null;

      const img = new Image();
      img.src = outputUrl;
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
