import { RuleSpec, SharedState } from '../types';
import { EventBus } from './EventBus';
import { Tilemap } from './Tilemap';
import { Rule, GravityFlipRule } from '../rules/GravityFlip';
import { FloorDecayRule } from '../rules/FloorDecay';

export class RulesEngine {
  private rules: Rule[] = [];
  private events: EventBus;

  constructor(events: EventBus) {
    this.events = events;
  }

  init(specs: RuleSpec[], tilemap: Tilemap): void {
    this.rules = [];

    for (const spec of specs) {
      const rule = this.createRule(spec.id);
      if (!rule) continue;

      // FloorDecay needs tilemap reference
      if (rule instanceof FloorDecayRule) {
        rule.setTilemap(tilemap);
      }

      rule.init(spec, this.events);
      this.rules.push(rule);
    }
  }

  update(state: SharedState, dt: number): void {
    for (const rule of this.rules) {
      rule.update(state, dt);
    }
  }

  clear(): void {
    this.rules = [];
  }

  private createRule(id: string): Rule | null {
    switch (id) {
      case 'gravity_flip': return new GravityFlipRule();
      case 'floor_decay':  return new FloorDecayRule();
      // Additional rules can be added here
      default:
        console.warn(`Unknown rule: ${id} — skipping`);
        return null;
    }
  }
}
