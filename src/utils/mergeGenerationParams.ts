import type { GenerationParams } from '../types';

/** Deep-merge LLM output into an existing session (Generate = tweak, not full reset). */
export function mergeGenerationParams(
  base: GenerationParams,
  incoming: Partial<GenerationParams>,
): GenerationParams {
  return {
    ...base,
    ...incoming,
    title: incoming.title ?? base.title,
    description: incoming.description ?? base.description,
    layout: incoming.layout ?? base.layout,
    theme: incoming.theme ?? base.theme,
    difficulty: typeof incoming.difficulty === 'number' ? incoming.difficulty : base.difficulty,
    sections:
      Array.isArray(incoming.sections) && incoming.sections.length >= 2
        ? incoming.sections
        : base.sections,
    abilities:
      Array.isArray(incoming.abilities) && incoming.abilities.length
        ? incoming.abilities
        : base.abilities,
    rules: Array.isArray(incoming.rules) ? incoming.rules : base.rules,
    voiceMomentCount:
      typeof incoming.voiceMomentCount === 'number'
        ? incoming.voiceMomentCount
        : base.voiceMomentCount,
    backgroundColor: incoming.backgroundColor ?? base.backgroundColor,
    palette:
      Array.isArray(incoming.palette) && incoming.palette.length >= 4
        ? incoming.palette
        : base.palette,
    assetDescriptions: {
      ...(base.assetDescriptions ?? {}),
      ...(incoming.assetDescriptions ?? {}),
    },
    startingHealth: incoming.startingHealth ?? base.startingHealth,
    gameSpeed: incoming.gameSpeed ?? base.gameSpeed,
    gravityStartsInverted: incoming.gravityStartsInverted ?? base.gravityStartsInverted,
  };
}
