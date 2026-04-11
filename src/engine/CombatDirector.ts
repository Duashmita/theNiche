import { SharedState } from '../types';

/** Tracks whether the player is actively in combat. */
export class CombatDirector {
  /**
   * Call every frame with wall-clock time (performance.now()).
   * Sets state.inCombat = true if the player was recently hit OR
   * a nearby enemy was detected within the last 3 seconds.
   */
  update(state: SharedState, now: number): void {
    const recentlyHit  = now - state.lastHitTime         < 3_000;
    const nearbyEnemy  = now - state.lastEnemyNearbyTime < 3_000;
    state.inCombat = recentlyHit || nearbyEnemy;
  }
}
