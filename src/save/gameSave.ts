import type { GameSpec, GenerationParams } from '../types';

export const SAVE_STORAGE_KEY = 'theNiche_savedGames_v1';

export interface GameSaveFileV1 {
  version: 1;
  savedAt: string;
  title: string;
  generationParams: GenerationParams;
  gameSpec: GameSpec;
}

export function parseSaveFile(json: string): GameSaveFileV1 | null {
  try {
    const o = JSON.parse(json) as GameSaveFileV1;
    if (o?.version !== 1 || !o.gameSpec || !o.generationParams) return null;
    return o;
  } catch {
    return null;
  }
}

export function listLocalSaves(): GameSaveFileV1[] {
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as GameSaveFileV1[];
    return Array.isArray(arr) ? arr.filter((s) => s?.version === 1 && s.gameSpec) : [];
  } catch {
    return [];
  }
}

export function pushLocalSave(entry: GameSaveFileV1, max = 8): void {
  const cur = listLocalSaves().filter((s) => s.savedAt !== entry.savedAt);
  cur.unshift(entry);
  localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(cur.slice(0, max)));
}

export function downloadSaveJson(entry: GameSaveFileV1): void {
  const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = entry.title.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'game';
  a.download = `theniche-${safe}-${entry.savedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
