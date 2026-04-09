/**
 * Loading screen rendered on the native canvas (320×180).
 * Shown while Gemini generates a game spec.
 */
export class LoadingScreen {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  private message = 'Loading...';
  private dots = 0;
  private dotTimer = 0;
  private frameCount = 0;

  // Cosmetic steps shown in sequence while waiting
  private readonly STEPS = [
    'Listening to your idea',
    'Imagining the world',
    'Placing the tiles',
    'Spawning enemies',
    'Hiding secrets',
    'Almost ready',
  ];
  private currentStep = 0;
  private stepTimer = 0;
  private readonly STEP_INTERVAL = 2200; // ms per step

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  show(initialMessage: string): void {
    this.visible = true;
    this.message  = initialMessage;
    this.currentStep = 0;
    this.stepTimer   = 0;
    this.dots        = 0;
    this.dotTimer    = 0;
    this.frameCount  = 0;
  }

  update(message: string): void {
    this.message = message;
  }

  hide(): void {
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Called every frame by the game loop when phase === 'loading'.
   * dt is in ms.
   */
  render(dt: number): void {
    if (!this.visible) return;

    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;

    this.frameCount++;
    this.dotTimer   += dt;
    this.stepTimer  += dt;

    // Animate dots
    if (this.dotTimer > 400) {
      this.dots = (this.dots + 1) % 4;
      this.dotTimer = 0;
    }

    // Advance cosmetic step
    if (this.stepTimer > this.STEP_INTERVAL && this.currentStep < this.STEPS.length - 1) {
      this.currentStep++;
      this.stepTimer = 0;
    }

    // ── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);

    // Subtle scanline effect
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < H; y += 2) {
      ctx.fillRect(0, y, W, 1);
    }

    // Ambient glow circle
    const pulse = 0.85 + Math.sin(this.frameCount * 0.04) * 0.15;
    const grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 80);
    grd.addColorStop(0,   `rgba(30,40,80,${pulse * 0.4})`);
    grd.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // ── Title ───────────────────────────────────────────────────────────────
    ctx.fillStyle = '#444';
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('VOICE CONSOLE', W / 2, H / 2 - 36);

    // ── Cosmetic step text ───────────────────────────────────────────────────
    const stepAlpha = Math.min(1, (this.stepTimer / 300)); // fade in new step
    const stepText  = this.STEPS[this.currentStep] + '.'.repeat(this.dots);
    ctx.fillStyle = `rgba(100,140,200,${stepAlpha * 0.9})`;
    ctx.font = '7px monospace';
    ctx.fillText(stepText, W / 2, H / 2 - 16);

    // ── Progress bar ─────────────────────────────────────────────────────────
    const BAR_W = 120;
    const BAR_H = 3;
    const BAR_X = (W - BAR_W) / 2;
    const BAR_Y = H / 2 + 2;
    const progress = (this.currentStep + 1) / this.STEPS.length;

    // Track
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);

    // Fill (animated tip)
    const fillW = BAR_W * progress;
    ctx.fillStyle = '#3355aa';
    ctx.fillRect(BAR_X, BAR_Y, fillW, BAR_H);

    // Animated bright tip
    const tipX = BAR_X + fillW - 2;
    if (fillW > 2) {
      ctx.fillStyle = `rgba(100,160,255,${0.6 + Math.sin(this.frameCount * 0.15) * 0.4})`;
      ctx.fillRect(tipX, BAR_Y, 3, BAR_H);
    }

    // ── Hint ─────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#222';
    ctx.font = '5px monospace';
    ctx.fillText('generating your game...', W / 2, H / 2 + 20);
  }
}
