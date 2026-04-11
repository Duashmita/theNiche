import { AssetMap, AssetType, GenerationParams, ThemeId } from '../types';

// Ordered by visual impact — most visible assets load first
const ASSET_TYPES: AssetType[] = [
  'background', 'ground', 'player', 'platform',
  'enemy_patrol', 'coin', 'enemy_flyer', 'hazard', 'decoration',
];

const TYPE_PROMPTS: Record<AssetType, string> = {
  ground:
    'seamless tileable ground texture square, edges wrap perfectly when tiled in a grid, continuous surface',
  platform:
    'seamless tileable floating terrain texture, same wrap rules as ground, solid block face',
  hazard:       'upward-pointing spikes, simple triangles',
  decoration:   'small background prop, bush or rock, minimal',
  player:
    'simple cartoon game hero, large clear eyes and visible friendly face, plain flat colors, ' +
    'minimal shading, no busy texture, idle facing right, transparent background',
  enemy_patrol:
    'simple cartoon enemy, big visible eyes or clear face dots, plain colors, minimal detail, facing right',
  enemy_flyer:
    'simple cartoon flying enemy, clear eyes, plain wings, flat colors, readable silhouette',
  coin:         'round golden coin, simple shine mark',
  background:
    'ultra-wide panoramic sidescroller backdrop, horizontal layered landscape, ' +
    'pretty atmospheric scenery with soft silhouettes and gentle depth, ' +
    'simplified readable shapes, not busy or cluttered, cohesive mood',
};

// Proxied through Vite dev server to avoid CORS — see vite.config.ts server.proxy
const REPLICATE_URL = '/api/replicate/v1/models/black-forest-labs/flux-1.1-pro/predictions';

export class AssetGenerator {
  constructor(private readonly apiKey: string) {}

  hasKey(): boolean {
    return this.apiKey.length > 10;
  }

  /** Generate all assets sequentially (rate limit: burst=1, 6/min).
   *  Calls onProgress after each asset so the renderer can patch immediately. */
  async generate(
    params: GenerationParams,
    onProgress?: (partial: AssetMap) => void,
  ): Promise<AssetMap> {
    const map: AssetMap = new Map();
    for (let i = 0; i < ASSET_TYPES.length; i++) {
      const type = ASSET_TYPES[i];
      const img = await this.generateOne(
        type, params.theme, params.description, params.palette, params.assetDescriptions,
      );
      if (img) {
        const key = `${params.theme}/${type}`;
        map.set(key, img);
        onProgress?.(new Map([[key, img]]));
      }
      // 11s gap between requests — Replicate free tier: burst=1, 6 req/min
      if (i < ASSET_TYPES.length - 1) {
        await new Promise(r => setTimeout(r, 11_000));
      }
    }
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
    assetDescriptions: Partial<Record<string, string>> = {},
  ): Promise<HTMLImageElement | null> {
    try {
      const prompt = this.buildPrompt(type, themeId, description, palette, assetDescriptions);
      const res = await fetch(REPLICATE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait',
        },
        body: JSON.stringify({
          input:
            type === 'background'
              ? {
                  prompt,
                  aspect_ratio: 'custom',
                  width: 1440,
                  height: 288,
                  output_format: 'png',
                  output_quality: 70,
                }
              : type === 'player'
              ? {
                  prompt,
                  aspect_ratio: '1:1',
                  width: 512,
                  height: 512,
                  output_format: 'png',
                  output_quality: 78,
                }
              : {
                  prompt,
                  aspect_ratio: '1:1',
                  output_format: 'png',
                  output_quality: 60,
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
    assetDescriptions: Partial<Record<string, string>> = {},
  ): string {
    const colors = palette.slice(0, 3).join(' ');
    // Prefer LLM-generated description; fall back to generic type hint
    const typeDesc = assetDescriptions[type] || TYPE_PROMPTS[type];
    const context = description ? `, ${description}` : '';
    if (type === 'background') {
      return (
        `2D game parallax backdrop, ${themeId} theme${context}, ${typeDesc}, ` +
        `soft limited palette harmonizing with ${colors}, smooth gradients between regions, ` +
        `no characters, no UI, no text, full opaque image`
      );
    }
    if (type === 'player') {
      return (
        `2D game character sprite, ${themeId} theme${context}, ${typeDesc}, ` +
        `use palette hints ${colors}, transparent background, no text, no UI`
      );
    }
    if (type === 'enemy_patrol' || type === 'enemy_flyer') {
      return (
        `2D game enemy sprite, ${themeId} theme${context}, ${typeDesc}, ` +
        `plain simple shapes, ${colors}, transparent background, no text`
      );
    }
    return (
      `2D game sprite, ${themeId} theme${context}, ${typeDesc}, ` +
      `16-bit pixel art, ${colors} palette only, clean edges, ` +
      `solid color fills, no anti-aliasing, transparent background, no text`
    );
  }
}
