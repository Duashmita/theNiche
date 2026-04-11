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
  private jumpHandler: (() => void) | null = null;
  private checkpointHandler: (() => void) | null = null;

  init(spec: RuleSpec, events: EventBus): void {
    if (this.jumpHandler) {
      events.off('player_jumped', this.jumpHandler);
      this.jumpHandler = null;
    }
    if (this.checkpointHandler) {
      events.off('checkpoint_reached', this.checkpointHandler);
      this.checkpointHandler = null;
    }

    this.trigger = (spec.trigger as string) || 'on_jump';
    const startInverted = !!(spec.params as { startInverted?: boolean }).startInverted;
    this.flipped = startInverted;

    if (this.trigger === 'on_jump') {
      this.jumpHandler = () => this.flip(events);
      events.on('player_jumped', this.jumpHandler);
    }
    if (this.trigger === 'on_contact_color') {
      this.checkpointHandler = () => this.flip(events);
      events.on('checkpoint_reached', this.checkpointHandler);
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
