import type { RuleId } from '../types';

const MODIFIERS: Array<{ id: RuleId; label: string }> = [
  { id: 'gravity_flip', label: 'Gravity flip' },
  { id: 'floor_decay', label: 'Floor decay' },
  { id: 'wind', label: 'Wind' },
  { id: 'speed_boost', label: 'Speed boost' },
  { id: 'vision_limit', label: 'Dim / limit vision' },
  { id: 'darkness', label: 'Darkness' },
  { id: 'time_limit', label: 'Time limit' },
];

const MAX_RULES = 2;
const PEEK_MS = 3000;

/**
 * Hidden by default. Shows for a few seconds only after Generate / Create new,
 * or stays open while you use Launch world. No hover-to-reveal.
 */
export class ModifierDock {
  private root: HTMLDivElement;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;
  private invertGravityCb: HTMLInputElement | null = null;
  private onLaunch: (() => void) | null = null;

  constructor(private readonly container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'modifier-dock';
    this.root.classList.add('modifier-dock--hidden');
    this.root.innerHTML = `
      <div class="modifier-dock__blur" aria-hidden="true"></div>
      <div class="modifier-dock__panel">
        <div class="modifier-dock__title">Modifiers</div>
        <div class="modifier-dock__sub">Optional — up to ${MAX_RULES}. Use <strong>Launch world</strong> to apply and regenerate the level (no AI art).</div>
        <div class="modifier-dock__list"></div>
        <label class="modifier-dock__invert">
          <input type="checkbox" data-invert-gravity />
          <span>Start upside-down (ceiling is floor)</span>
        </label>
        <button type="button" class="modifier-dock__launch" data-launch-modifiers>Launch world</button>
      </div>
    `;
    this.container.appendChild(this.root);

    const list = this.root.querySelector('.modifier-dock__list')!;
    for (const m of MODIFIERS) {
      const row = document.createElement('label');
      row.className = 'modifier-dock__row';
      row.innerHTML = `<input type="checkbox" data-rule="${m.id}" /><span>${m.label}</span>`;
      list.appendChild(row);
    }

    this.invertGravityCb = this.root.querySelector('[data-invert-gravity]');

    this.root.querySelectorAll<HTMLInputElement>('input[data-rule]').forEach((el) => {
      el.addEventListener('change', () => this.enforceMaxRules(el));
    });

    this.root.querySelector('[data-launch-modifiers]')?.addEventListener('click', (e) => {
      e.preventDefault();
      (e.target as HTMLElement).blur();
      this.cancelPeek();
      this.onLaunch?.();
    });

    // Stop the 3s auto-hide if the player starts using the panel
    this.root.querySelector('.modifier-dock__panel')?.addEventListener('pointerdown', () => {
      this.cancelPeek();
    });
  }

  setOnLaunch(handler: () => void): void {
    this.onLaunch = handler;
  }

  private enforceMaxRules(changed: HTMLInputElement): void {
    if (!changed.checked) return;
    const checked = [...this.root.querySelectorAll<HTMLInputElement>('input[data-rule]:checked')];
    while (checked.length > MAX_RULES) {
      const first = checked.shift();
      if (first && first !== changed) first.checked = false;
    }
  }

  getSelectedRules(): RuleId[] {
    const out: RuleId[] = [];
    this.root.querySelectorAll<HTMLInputElement>('input[data-rule]:checked').forEach((el) => {
      const id = el.dataset.rule as RuleId;
      if (id) out.push(id);
    });
    return out.slice(0, MAX_RULES);
  }

  getStartInvertedGravity(): boolean {
    return !!this.invertGravityCb?.checked;
  }

  reset(): void {
    this.root.querySelectorAll<HTMLInputElement>('input[data-rule]').forEach((el) => { el.checked = false; });
    if (this.invertGravityCb) this.invertGravityCb.checked = false;
  }

  /** Show panel for a few seconds, then hide (Generate / Create new only). */
  peekBriefly(): void {
    this.cancelPeek();
    this.root.classList.remove('modifier-dock--hidden');
    this.peekTimer = setTimeout(() => {
      this.peekTimer = null;
      this.root.classList.add('modifier-dock--hidden');
    }, PEEK_MS);
  }

  /** Keep open until user dismisses or launches (after opening via Launch flow). */
  showStayOpen(): void {
    this.cancelPeek();
    this.root.classList.remove('modifier-dock--hidden');
  }

  cancelPeek(): void {
    if (this.peekTimer) {
      clearTimeout(this.peekTimer);
      this.peekTimer = null;
    }
  }

  hide(): void {
    this.cancelPeek();
    this.root.classList.add('modifier-dock--hidden');
  }
}
