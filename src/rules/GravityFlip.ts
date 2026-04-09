import { EventBus } from '../engine/EventBus';
import { RuleSpec, SharedState } from '../types';

export interface Rule {
  id: string;
  init(spec: RuleSpec, events: EventBus): void;
  update(state: SharedState, dt: number): void;
}

export class GravityFlipRule implements Rule {
  readonly id = 'gravity_flip';
  private flipped = false;
  private readonly BASE_GRAVITY = 0.8;
  private trigger: string = 'on_jump';

  init(spec: RuleSpec, events: EventBus): void {
    this.trigger = (spec.trigger as string) || 'on_jump';
    this.flipped = false;

    if (this.trigger === 'on_jump') {
      events.on('player_jumped', () => this.flip(events));
    }
    if (this.trigger === 'on_contact_color') {
      // Could wire to a specific collectible event — for demo, wire to checkpoint
      events.on('checkpoint_reached', () => this.flip(events));
    }
  }

  update(state: SharedState, _dt: number): void {
    state.gravity = this.flipped ? -this.BASE_GRAVITY : this.BASE_GRAVITY;
  }

  private flip(events: EventBus): void {
    this.flipped = !this.flipped;
    events.emit('gravity_flipped', { flipped: this.flipped });
  }

  reset(): void {
    this.flipped = false;
  }
}
