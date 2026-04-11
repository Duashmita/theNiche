import { SharedState, SpawnParams } from '../types';
import { lerp, clamp } from '../utils/math';

export class EnemyDirector {
  /**
   * Tick enemy level based on current skill rating.
   * Call periodically (e.g. every 2 s), NOT every frame.
   */
  updateEnemyLevel(state: SharedState): void {
    const skill = state.playerSkillRating;
    if (skill > 0.8)      state.enemyLevel += 1.2;
    else if (skill < 0.3) state.enemyLevel += 0.5;
    else                  state.enemyLevel += 0.8;
  }

  /**
   * Sinusoidal intensity wave so enemy pressure ebbs and flows
   * rather than escalating monotonically. Call every frame.
   */
  updateIntensity(state: SharedState, time: number): void {
    state.enemyIntensity = 0.5 + ((Math.sin(time / 20_000) + 1) / 2) * 0.7;
  }

  /**
   * Returns spawn parameters scaled by enemy level and skill rating.
   * Used by EntitySystem.spawnMaskEnemies and any wave-spawn logic.
   *
   * Behavior unlock table:
   *   lvl 1–2 → melee only
   *   lvl 3–4 → fast movement
   *   lvl 5–6 → can shoot
   *   lvl 7–8 → predictive aim (aggression high)
   *   lvl 9+  → hybrid (shoot + dash)
   */
  getSpawnParams(state: SharedState): SpawnParams {
    const lvl = state.enemyLevel * lerp(0.75, 1.25, state.playerSkillRating);
    return {
      count:      Math.max(1, Math.floor(1 + lvl * state.enemyIntensity)),
      speed:      1 + lvl * 0.1,
      canShoot:   lvl > 4,
      aggression: clamp(lvl * 0.05, 0, 0.8),
    };
  }

  /**
   * Map a numeric enemy level to the most appropriate archetype string.
   */
  getPreferredArchetype(enemyLevel: number): string {
    if (enemyLevel >= 9)  return 'boss';
    if (enemyLevel >= 7)  return 'turret';
    if (enemyLevel >= 5)  return 'flyer';
    if (enemyLevel >= 3)  return 'chaser';
    return 'patrol';
  }
}
