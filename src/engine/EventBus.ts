type Callback = (data?: any) => void;

export class EventBus {
  private listeners: Map<string, Callback[]> = new Map();

  on(event: string, callback: Callback): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Callback): void {
    const cbs = this.listeners.get(event);
    if (!cbs) return;
    const i = cbs.indexOf(callback);
    if (i !== -1) cbs.splice(i, 1);
  }

  emit(event: string, data?: any): void {
    // Copy array before iterating so listeners added during emit are not called
    const cbs = this.listeners.get(event);
    if (!cbs) return;
    [...cbs].forEach(cb => cb(data));
  }

  clear(): void {
    this.listeners.clear();
  }
}

/*
  Events emitted across all systems — keep this as source of truth:

  Input:     (none — other systems read input state directly)

  Player:    'player_jumped'   { vx }
             'player_landed'   { vy, tileX, tileY }   ← tileX/tileY included (FloorDecay needs them)
             'player_died'     {}
             'player_damaged'  { newHealth }
             'player_entered_trigger'  { tileKey: string, tileX: number, tileY: number }

  Physics:   'player_hit_hazard'  {}
             'player_hit_ceiling' {}

  Entities:  'enemy_killed'         { entity }
             'collectible_picked_up'{ entity }
             'npc_interacted'       { entity }
             'checkpoint_reached'   { entity }

  Rules:     'rule_activated'   { ruleId }
             'gravity_flipped' { flipped: boolean }
             'floor_decayed'   { tileX, tileY }

  Juice:     (none — only listens)
  Audio:     (none — only listens)

  VoiceMoment:
             'voice_moment_triggered'   { moment }
             'voice_moment_listening'   {}
             'voice_moment_processing'  {}
             'voice_moment_ready'       { interpretation: string }
             'voice_moment_revealed'    { response }
*/
