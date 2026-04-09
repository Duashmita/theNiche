import { Easing } from './math';

interface ActiveTween {
  target:   Record<string, number>;
  key:      string;
  from:     number;
  to:       number;
  duration: number;
  elapsed:  number;
  easing:   (t: number) => number;
  onComplete?: () => void;
}

export class TweenManager {
  private tweens: ActiveTween[] = [];

  to(
    target: Record<string, number>,
    key: string,
    to: number,
    duration: number,
    options: { easing?: (t: number) => number; onComplete?: () => void } = {},
  ): void {
    // Kill any existing tween on same target+key
    this.tweens = this.tweens.filter(t => !(t.target === target && t.key === key));
    this.tweens.push({
      target,
      key,
      from: target[key] ?? 0,
      to,
      duration,
      elapsed: 0,
      easing: options.easing ?? Easing.easeOut,
      onComplete: options.onComplete,
    });
  }

  update(dt: number): void {
    this.tweens = this.tweens.filter(tw => {
      tw.elapsed += dt;
      const t = Math.min(tw.elapsed / tw.duration, 1);
      tw.target[tw.key] = tw.from + (tw.to - tw.from) * tw.easing(t);
      if (t >= 1) {
        tw.target[tw.key] = tw.to;
        tw.onComplete?.();
        return false;
      }
      return true;
    });
  }

  clear(): void {
    this.tweens = [];
  }
}
