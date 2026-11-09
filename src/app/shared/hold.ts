import { DestroyRef, Directive, inject, output } from '@angular/core';

const HOLD_MS = 500;
const MOVE_PX = 10;

/** Swallows the click that ends a hold, wherever it lands, until the next touch begins. */
function swallowNextClick(): void {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    stop();
  };
  const stop = () => {
    document.removeEventListener('click', swallow, true);
    document.removeEventListener('pointerdown', stop, true);
  };
  document.addEventListener('click', swallow, true);
  document.addEventListener('pointerdown', stop, true);
}

/**
 * Tells a tap from a press and hold. What a hold opens can appear right under the finger, and
 * the click on release would land on it and close it again.
 */
@Directive({
  selector: '[appHold]',
  host: {
    '(pointerdown)': 'down($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'stop()',
    '(pointercancel)': 'stop()',
    '(pointerleave)': 'stop()',
    '(contextmenu)': '$event.preventDefault()',
    '(click)': 'tapped.emit()',
  },
})
export class Hold {
  readonly tapped = output<void>();
  readonly held = output<void>();

  private timer: ReturnType<typeof setTimeout> | undefined;
  private start: { x: number; y: number } | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected down(event: PointerEvent): void {
    this.stop();
    this.start = { x: event.clientX, y: event.clientY };
    this.timer = setTimeout(() => {
      swallowNextClick();
      this.held.emit();
    }, HOLD_MS);
  }

  protected move(event: PointerEvent): void {
    if (!this.start) return;
    if (Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) > MOVE_PX) {
      this.stop();
    }
  }

  protected stop(): void {
    clearTimeout(this.timer);
    this.start = null;
  }
}
