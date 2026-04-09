import { EventBus } from './EventBus';
import { randomFloat } from '../utils/math';

interface ToneOpts {
  frequency: number;
  endFrequency?: number;
  type: OscillatorType;
  gain: number;
  duration: number;   // milliseconds
  delay?: number;     // seconds from AudioContext.currentTime
}

export class AudioManager {
  private ctx: AudioContext | null = null;

  constructor(events: EventBus) {
    events.on('player_jumped', (_data: unknown) => {
      this.play('jump');
    });

    events.on('player_landed', (data: { vy: number }) => {
      if (data?.vy > 4) this.play('land');
    });

    events.on('collectible_picked_up', (_data: unknown) => {
      this.play('coin');
    });

    events.on('player_damaged', (_data: unknown) => {
      this.play('hurt');
    });

    events.on('enemy_killed', (_data: unknown) => {
      this.play('enemy_die');
    });

    events.on('voice_moment_triggered', (_data: unknown) => {
      this.play('voice_chime');
    });

    events.on('checkpoint_reached', (_data: unknown) => {
      this.play('checkpoint');
    });

    events.on('gravity_flipped', (_data: unknown) => {
      this.play('gravity_flip');
    });
  }

  // ── AudioContext lazy init ────────────────────────────────────────────────────

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      // Best-effort resume — can only succeed after a user gesture
      this.ctx.resume().catch(() => { /* intentional no-op */ });
    }
    return this.ctx;
  }

  // ── Public play dispatcher ────────────────────────────────────────────────────

  play(sound: string): void {
    try {
      switch (sound) {
        case 'jump':
          this._playJump();
          break;
        case 'land':
          this._playLand();
          break;
        case 'coin':
          this._playCoin();
          break;
        case 'hurt':
          this._playHurt();
          break;
        case 'enemy_die':
          this._playEnemyDie();
          break;
        case 'voice_chime':
          this._playVoiceChime();
          break;
        case 'checkpoint':
          this._playCheckpoint();
          break;
        case 'gravity_flip':
          this._playGravityFlip();
          break;
        default:
          break;
      }
    } catch (_e) {
      // Audio must never crash the game
    }
  }

  // ── Sound implementations ─────────────────────────────────────────────────────

  private _playJump(): void {
    this._playTone({
      frequency: 220,
      endFrequency: 440,
      type: 'square',
      gain: 0.15,
      duration: 80,
    });
  }

  private _playLand(): void {
    this._playTone({
      frequency: 120,
      endFrequency: 60,
      type: 'sine',
      gain: 0.2,
      duration: 50,
    });
  }

  private _playCoin(): void {
    // Two-stage pitch glide: 880→1100 then 1100→1400
    this._playTone({
      frequency: 880,
      endFrequency: 1100,
      type: 'triangle',
      gain: 0.15,
      duration: 30,
      delay: 0,
    });
    this._playTone({
      frequency: 1100,
      endFrequency: 1400,
      type: 'triangle',
      gain: 0.15,
      duration: 70,
      delay: 0.03, // start immediately after first segment
    });
  }

  private _playHurt(): void {
    try {
      const ctx = this.getCtx();

      // Two slightly detuned sawtooth oscillators for a harsh buzz
      const createBuzzOsc = (freq: number, detune: number, startTime: number) => {
        const osc = ctx.createOscillator();
        const waveShaper = ctx.createWaveShaper();
        const gainNode = ctx.createGain();

        // Gentle distortion curve
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          const x = (i * 2) / 256 - 1;
          curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
        }
        waveShaper.curve = curve;

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, startTime);
        osc.detune.setValueAtTime(detune, startTime);

        gainNode.gain.setValueAtTime(0.2, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

        osc.connect(waveShaper);
        waveShaper.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.16);
      };

      const now = ctx.currentTime;
      createBuzzOsc(220, 0, now);
      createBuzzOsc(230, 12, now); // slight detune between the two
    } catch (_e) {
      // Fallback: silent fail
    }
  }

  private _playEnemyDie(): void {
    this._playTone({
      frequency: 300,
      endFrequency: 50,
      type: 'sawtooth',
      gain: 0.2,
      duration: 150,
    });
  }

  private _playVoiceChime(): void {
    // C5, E5, G5 — each 80 ms, staggered
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      this._playTone({
        frequency: freq,
        type: 'triangle',
        gain: 0.1,
        duration: 80,
        delay: idx * 0.08,
      });
    });
  }

  private _playCheckpoint(): void {
    this._playTone({
      frequency: 440,
      endFrequency: 880,
      type: 'triangle',
      gain: 0.12,
      duration: 200,
    });
  }

  private _playGravityFlip(): void {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;
      const dur = 0.2; // 200 ms total

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.type = 'sine';

      // 100 → 500 → 100 pitch sweep
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(500, now + dur / 2);
      osc.frequency.exponentialRampToValueAtTime(100, now + dur);

      gainNode.gain.setValueAtTime(0.12, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.start(now);
      osc.stop(now + dur + 0.01);
    } catch (_e) {
      // Silent fail
    }
  }

  // ── Core synthesis helper ─────────────────────────────────────────────────────

  private _playTone(opts: ToneOpts): void {
    try {
      const ctx = this.getCtx();
      const delayS = opts.delay ?? 0;
      const durS = opts.duration / 1000;
      const startTime = ctx.currentTime + delayS;

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.type = opts.type;
      osc.frequency.setValueAtTime(opts.frequency, startTime);

      if (opts.endFrequency !== undefined) {
        // exponentialRampToValueAtTime requires a positive non-zero target
        const safeEnd = Math.max(opts.endFrequency, 1);
        osc.frequency.exponentialRampToValueAtTime(safeEnd, startTime + durS);
      }

      gainNode.gain.setValueAtTime(opts.gain, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + durS);

      osc.start(startTime);
      osc.stop(startTime + durS + 0.01);
    } catch (_e) {
      // Audio must never crash the game
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  dispose(): void {
    try {
      if (this.ctx) {
        this.ctx.close();
        this.ctx = null;
      }
    } catch (_e) {
      // Silent fail
    }
  }
}
