export class InputSystem {
  left = false;
  right = false;
  up = false;
  down = false;
  jump = false;
  dash = false;
  /** Hold F — fly / anti-gravity (glide ability). */
  fly = false;

  jumpPressedAt = 0;
  jumpBuffered = false;
  dashPressedAt = 0;
  dashBuffered = false;
  shootPressedAt = 0;
  shootBuffered = false;
  meleePressedAt = 0;
  meleeBuffered = false;
  grapplePressedAt = 0;
  grappleBuffered = false;
  /** Left Shift edge — ground pound (air) or size cycle (ground). */
  shiftLeftPressedAt = 0;
  shiftLeftBuffered = false;

  private prevJump = false;
  private prevDash = false;
  private prevShoot = false;
  private prevMelee = false;
  private prevGrapple = false;
  private prevShiftLeft = false;

  private readonly JUMP_BUFFER_MS = 100;
  private readonly DASH_BUFFER_MS = 150;
  private readonly ACTION_BUFFER_MS = 120;

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
    const active = document.activeElement as HTMLElement | null;
    const typingUi =
      !!active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable);
    if (typingUi) {
      this.left = this.right = this.up = this.down = false;
      this.jump = this.dash = this.fly = false;
      this.jumpBuffered = false;
      this.dashBuffered = false;
      this.shootBuffered = false;
      this.meleeBuffered = false;
      this.grappleBuffered = false;
      this.shiftLeftBuffered = false;
      this.prevJump = false;
      this.prevDash = false;
      this.prevShoot = false;
      this.prevMelee = false;
      this.prevGrapple = false;
      this.prevShiftLeft = false;
      return;
    }

    const kLeft  = this.keysDown.has('ArrowLeft')  || this.keysDown.has('KeyA');
    const kRight = this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD');
    const kUp    = this.keysDown.has('ArrowUp')    || this.keysDown.has('KeyW');
    const kDown  = this.keysDown.has('ArrowDown')  || this.keysDown.has('KeyS');
    const kJump  = this.keysDown.has('Space') || this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW');
    /** Mario-style dash — X (Shift reserved for pound / size). */
    const kDash  = this.keysDown.has('KeyX');
    const kFly   = this.keysDown.has('KeyF');
    const kShoot = this.keysDown.has('KeyZ');
    const kMelee = this.keysDown.has('KeyE');
    const kGrapple = this.keysDown.has('KeyG');
    const kShiftLeft = this.keysDown.has('ShiftLeft');

    let gpLeft  = false;
    let gpRight = false;
    let gpUp    = false;
    let gpJump  = false;
    let gpDash  = false;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0];
    if (gp) {
      const axisX = gp.axes[0] ?? 0;
      if (axisX < -0.3) gpLeft  = true;
      if (axisX >  0.3) gpRight = true;

      const btn12 = gp.buttons[12];
      const btn14 = gp.buttons[14];
      const btn15 = gp.buttons[15];
      if (btn14 && btn14.pressed) gpLeft  = true;
      if (btn15 && btn15.pressed) gpRight = true;
      if (btn12 && btn12.pressed) gpUp    = true;

      const btn0 = gp.buttons[0];
      const btn1 = gp.buttons[1];
      if (btn0 && btn0.pressed) gpJump = true;
      if (btn1 && btn1.pressed) gpDash = true;
    }

    this.left  = kLeft  || gpLeft;
    this.right = kRight || gpRight;
    this.up    = kUp    || gpUp;
    this.down  = kDown;
    this.jump  = kJump  || gpJump;
    this.dash  = kDash  || gpDash;
    this.fly   = kFly;

    const now = performance.now();

    if (this.jump && !this.prevJump) {
      this.jumpPressedAt = now;
    }
    this.jumpBuffered = (now - this.jumpPressedAt) < this.JUMP_BUFFER_MS;
    this.prevJump = this.jump;

    if (this.dash && !this.prevDash) {
      this.dashPressedAt = now;
    }
    this.dashBuffered = (now - this.dashPressedAt) < this.DASH_BUFFER_MS;
    this.prevDash = this.dash;

    if (kShoot && !this.prevShoot) {
      this.shootPressedAt = now;
    }
    this.shootBuffered = (now - this.shootPressedAt) < this.ACTION_BUFFER_MS;
    this.prevShoot = kShoot;

    if (kMelee && !this.prevMelee) {
      this.meleePressedAt = now;
    }
    this.meleeBuffered = (now - this.meleePressedAt) < this.ACTION_BUFFER_MS;
    this.prevMelee = kMelee;

    if (kGrapple && !this.prevGrapple) {
      this.grapplePressedAt = now;
    }
    this.grappleBuffered = (now - this.grapplePressedAt) < this.ACTION_BUFFER_MS;
    this.prevGrapple = kGrapple;

    if (kShiftLeft && !this.prevShiftLeft) {
      this.shiftLeftPressedAt = now;
    }
    this.shiftLeftBuffered = (now - this.shiftLeftPressedAt) < this.ACTION_BUFFER_MS;
    this.prevShiftLeft = kShiftLeft;
  }

  consumeJump(): void {
    this.jumpPressedAt = 0;
    this.jumpBuffered = false;
  }

  consumeDash(): void {
    this.dashPressedAt = 0;
    this.dashBuffered = false;
  }

  consumeShoot(): void {
    this.shootPressedAt = 0;
    this.shootBuffered = false;
  }

  consumeMelee(): void {
    this.meleePressedAt = 0;
    this.meleeBuffered = false;
  }

  consumeGrapple(): void {
    this.grapplePressedAt = 0;
    this.grappleBuffered = false;
  }

  consumeShiftLeft(): void {
    this.shiftLeftPressedAt = 0;
    this.shiftLeftBuffered = false;
  }
}
