export class InputSystem {
  left = false;
  right = false;
  up = false;
  down = false;
  jump = false;
  dash = false;

  jumpPressedAt = 0;
  jumpBuffered = false;
  dashPressedAt = 0;
  dashBuffered = false;

  private prevJump = false;
  private prevDash = false;

  private readonly JUMP_BUFFER_MS = 100;
  private readonly DASH_BUFFER_MS = 150;

  private keysDown = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this.keysDown.add(e.code);
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    });
  }

  update(): void {
    // ── Keyboard state ───────────────────────────────────────────────────────
    const kLeft  = this.keysDown.has('ArrowLeft')  || this.keysDown.has('KeyA');
    const kRight = this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD');
    const kUp    = this.keysDown.has('ArrowUp')    || this.keysDown.has('KeyW');
    const kDown  = this.keysDown.has('ArrowDown')  || this.keysDown.has('KeyS');
    const kJump  = this.keysDown.has('Space')      || this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW');
    const kDash  = this.keysDown.has('ShiftLeft')  || this.keysDown.has('ShiftRight') || this.keysDown.has('KeyX');

    // ── Gamepad state ────────────────────────────────────────────────────────
    let gpLeft  = false;
    let gpRight = false;
    let gpUp    = false;
    let gpJump  = false;
    let gpDash  = false;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0];
    if (gp) {
      // Axes: axes[0] is left stick X (-1 = left, 1 = right)
      const axisX = gp.axes[0] ?? 0;
      if (axisX < -0.3) gpLeft  = true;
      if (axisX >  0.3) gpRight = true;

      // D-pad buttons vary by browser mapping (standard mapping)
      // buttons[12]=up, [13]=down, [14]=left, [15]=right (standard)
      const btn12 = gp.buttons[12];
      const btn13 = gp.buttons[13];
      const btn14 = gp.buttons[14];
      const btn15 = gp.buttons[15];
      if (btn14 && btn14.pressed) gpLeft  = true;
      if (btn15 && btn15.pressed) gpRight = true;
      if (btn12 && btn12.pressed) gpUp    = true;

      // buttons[0] = A = jump, buttons[1] = B = dash
      const btn0 = gp.buttons[0];
      const btn1 = gp.buttons[1];
      if (btn0 && btn0.pressed) gpJump = true;
      if (btn1 && btn1.pressed) gpDash = true;
    }

    // ── Merge keyboard + gamepad ──────────────────────────────────────────────
    this.left  = kLeft  || gpLeft;
    this.right = kRight || gpRight;
    this.up    = kUp    || gpUp;
    this.down  = kDown;
    this.jump  = kJump  || gpJump;
    this.dash  = kDash  || gpDash;

    // ── Jump buffer ───────────────────────────────────────────────────────────
    const now = performance.now();

    if (this.jump && !this.prevJump) {
      this.jumpPressedAt = now;
    }
    this.jumpBuffered = (now - this.jumpPressedAt) < this.JUMP_BUFFER_MS;
    this.prevJump = this.jump;

    // ── Dash buffer ───────────────────────────────────────────────────────────
    if (this.dash && !this.prevDash) {
      this.dashPressedAt = now;
    }
    this.dashBuffered = (now - this.dashPressedAt) < this.DASH_BUFFER_MS;
    this.prevDash = this.dash;
  }

  consumeJump(): void {
    this.jumpPressedAt = 0;
    this.jumpBuffered = false;
  }

  consumeDash(): void {
    this.dashPressedAt = 0;
    this.dashBuffered = false;
  }
}
