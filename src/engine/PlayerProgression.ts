import { SharedState } from '../types';
import { clamp } from '../utils/math';

export class PlayerProgression {
  /**
   * Award XP to the player. Triggers level-ups automatically (handles
   * multiple level-ups in one call if XP overflows twice or more).
   */
  gainXP(amount: number, state: SharedState): void {
    state.playerXP += amount;
    while (state.playerXP >= state.xpToNext) {
      state.playerXP -= state.xpToNext;
      this.levelUp(state);
    }
  }

  private levelUp(state: SharedState): void {
    state.playerLevel++;
    state.xpToNext = Math.floor(state.xpToNext * 1.25);

    // Every level: +10 max energy
    state.maxEnergy += 10;

    // Every even level: +5 max health, partial heal
    if (state.playerLevel % 2 === 0) {
      state.maxHealth += 5;
      state.health = Math.min(state.health + 2, state.maxHealth);
    }

    state.levelUpToast = {
      level: state.playerLevel,
      displayUntil: performance.now() + 2000,
    };
  }

  /**
   * Recalculates playerSkillRating (0–1) from HP ratio, deaths, and
   * elapsed section time. Call periodically (e.g. every 2 s).
   */
  updateSkillRating(state: SharedState): void {
    const hp       = state.maxHealth > 0 ? state.health / state.maxHealth : 1;
    const deaths   = state.deathsThisSection;
    const elapsed  = performance.now() - state.sectionStartTimeMs;
    const timeFactor = 1 / (1 + elapsed / 60_000); // decays over 60 s

    state.playerSkillRating = clamp(
      hp * 0.4 + (1 / (1 + deaths)) * 0.4 + timeFactor * 0.2,
      0,
      1,
    );
  }
}
