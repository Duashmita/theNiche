import { EventBus } from '../engine/EventBus';
import { VoiceMomentPhase } from '../types';

/**
 * HTML overlay for voice moment UI — drawn on top of the game canvas.
 * Shows: prompt, waveform, processing state, interpretation reveal.
 * Pointer-events are disabled so it doesn't intercept game input.
 */
export class VoiceMomentOverlay {
  private container: HTMLElement;
  private el: HTMLDivElement;
  private phase: VoiceMomentPhase = VoiceMomentPhase.IDLE;
  private prompt = '';
  private interpretation = '';
  private waveformBars: number[] = new Array(20).fill(0);
  private waveformTimer = 0;
  private frameCount = 0;
  private rafId: number | null = null;

  constructor(container: HTMLElement, events: EventBus) {
    this.container = container;

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding-top: 14px;
      pointer-events: none;
      font-family: 'Courier New', monospace;
      opacity: 0;
      transition: opacity 0.2s;
    `;
    this.container.appendChild(this.el);

    // Wire events
    events.on('voice_moment_triggered', (data: { moment: { prompt: string } }) => {
      this.prompt = data?.moment?.prompt || 'What happens next?';
      this.interpretation = '';
      this.show(VoiceMomentPhase.LISTENING);
    });

    events.on('voice_moment_listening', () => {
      this.show(VoiceMomentPhase.LISTENING);
    });

    events.on('voice_moment_processing', () => {
      this.show(VoiceMomentPhase.PROCESSING);
    });

    events.on('voice_moment_ready', (data: { interpretation?: string }) => {
      this.interpretation = data?.interpretation || '';
      this.show(VoiceMomentPhase.READY);
    });

    events.on('voice_moment_revealed', () => {
      this.show(VoiceMomentPhase.REVEALING);
      setTimeout(() => this.hide(), 1800);
    });

    // Also expose interim transcript updates
    events.on('voice_interim', (data: { text: string }) => {
      this.interpretation = data?.text || '';
      this.render();
    });
  }

  private show(phase: VoiceMomentPhase): void {
    this.phase = phase;
    this.el.style.opacity = '1';
    this.render();
    this.startAnimating();
  }

  private hide(): void {
    this.el.style.opacity = '0';
    setTimeout(() => {
      this.phase = VoiceMomentPhase.IDLE;
      this.el.innerHTML = '';
      this.stopAnimating();
    }, 250);
  }

  private startAnimating(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this.frameCount++;
      this.animateWaveform();
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopAnimating(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private animateWaveform(): void {
    if (this.phase !== VoiceMomentPhase.LISTENING) return;
    // Animate bars with random heights (simulating mic input)
    for (let i = 0; i < this.waveformBars.length; i++) {
      const target = Math.random() * 0.8 + 0.1;
      this.waveformBars[i] = this.waveformBars[i] * 0.5 + target * 0.5;
    }
  }

  updateInterim(text: string): void {
    this.interpretation = text;
  }

  private render(): void {
    if (this.phase === VoiceMomentPhase.IDLE) return;

    const pulseAlpha = 0.6 + Math.sin(this.frameCount * 0.12) * 0.4;

    let html = '';

    // ── Top border pulse ──────────────────────────────────────────────────────
    const borderColor = this.phase === VoiceMomentPhase.LISTENING
      ? `rgba(200,80,80,${pulseAlpha})`
      : this.phase === VoiceMomentPhase.PROCESSING
        ? `rgba(80,120,200,${pulseAlpha})`
        : `rgba(80,200,120,${pulseAlpha})`;

    html += `<div style="
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: ${borderColor};
      box-shadow: 0 0 8px ${borderColor};
    "></div>`;

    // ── Prompt text ───────────────────────────────────────────────────────────
    html += `<div style="
      color: rgba(220,220,240,0.95);
      font-size: 11px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 8px;
      text-shadow: 0 0 6px rgba(100,140,255,0.6);
    ">${this.prompt}</div>`;

    // ── Phase-specific content ────────────────────────────────────────────────
    if (this.phase === VoiceMomentPhase.LISTENING) {
      // Waveform visualizer
      const bars = this.waveformBars.map(h => {
        const px = Math.floor(h * 20);
        return `<div style="
          width: 3px;
          height: ${px}px;
          background: rgba(220,80,80,${0.5 + h * 0.5});
          border-radius: 1px;
          align-self: flex-end;
        "></div>`;
      }).join('');

      html += `
        <div style="
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 24px;
          margin-bottom: 6px;
        ">${bars}</div>
        <div style="color: rgba(200,80,80,${pulseAlpha}); font-size: 9px; letter-spacing: 2px;">
          ● LISTENING
        </div>`;
    }

    if (this.phase === VoiceMomentPhase.PROCESSING) {
      const dotCount = 1 + (Math.floor(this.frameCount / 15) % 3);
      html += `
        <div style="color: rgba(80,120,200,0.9); font-size: 9px; letter-spacing: 2px; margin-bottom: 4px;">
          PROCESSING${'.'.repeat(dotCount)}
        </div>`;
      if (this.interpretation) {
        html += `<div style="
          color: rgba(150,160,180,0.7);
          font-size: 9px;
          font-style: italic;
          max-width: 200px;
          text-align: center;
        ">"${this.interpretation}"</div>`;
      }
    }

    if (this.phase === VoiceMomentPhase.READY || this.phase === VoiceMomentPhase.REVEALING) {
      const revealAlpha = this.phase === VoiceMomentPhase.REVEALING
        ? Math.min(1, (this.frameCount % 60) / 20)
        : 1;
      html += `
        <div style="
          color: rgba(80,200,120,${revealAlpha});
          font-size: 10px;
          letter-spacing: 1.5px;
          margin-bottom: 4px;
        ">▶ ${this.interpretation || 'Something happens...'}</div>`;
    }

    this.el.innerHTML = html;
  }
}
