import { DOCUMENT, inject, Injectable } from '@angular/core';

interface Viewport {
  height: number;
  offsetTop: number;
}

/** How much of the window the keyboard covers, px. */
export const keyboardHeight = (windowHeight: number, viewport: Viewport): number =>
  Math.max(0, Math.round(windowHeight - viewport.height - viewport.offsetTop));

/** Room to keep under a field, for the hint below it. */
const HINT_ROOM = 96;

/** How far to scroll so that a field and the hint under it clear the keyboard, px. */
export function revealBy(box: { top: number; bottom: number }, viewport: Viewport): number {
  const room = viewport.offsetTop + viewport.height - HINT_ROOM;
  const needed = box.bottom - room;
  // A tall field keeps its top in sight rather than its bottom.
  return Math.max(0, Math.min(needed, box.top - viewport.offsetTop));
}

const NOT_TYPED = new Set(['button', 'checkbox', 'color', 'file', 'radio', 'range', 'submit']);

/**
 * Keeps the focused field above the iOS keyboard, which covers the page without resizing it.
 * The scrolling container gets a bottom padding of the keyboard's height, so that even the last
 * field on it can be scrolled clear.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardInset {
  private readonly document = inject(DOCUMENT);
  private padded: { element: HTMLElement; own: number } | null = null;

  start(): void {
    const viewport = this.document.defaultView?.visualViewport;
    if (!viewport) return;
    const update = () => this.update(viewport);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    this.document.addEventListener('focusin', update);
    this.document.addEventListener('focusout', update);
  }

  private field(): HTMLElement | null {
    const active = this.document.activeElement;
    if (active instanceof HTMLTextAreaElement) return active;
    return active instanceof HTMLInputElement && !NOT_TYPED.has(active.type) ? active : null;
  }

  private scrollerOf(element: HTMLElement): HTMLElement | null {
    const view = this.document.defaultView as Window;
    for (let at = element.parentElement; at; at = at.parentElement) {
      if (/auto|scroll/.test(view.getComputedStyle(at).overflowY)) return at;
    }
    return null;
  }

  private update(viewport: VisualViewport): void {
    const view = this.document.defaultView as Window;
    const height = keyboardHeight(view.innerHeight, viewport);
    const field = height > 0 ? this.field() : null;
    const scroller = field && this.scrollerOf(field);
    // Taken off only when it moves on: the scroll position would not survive a shorter page.
    if (this.padded && this.padded.element !== scroller) {
      this.padded.element.style.removeProperty('padding-bottom');
      this.padded = null;
    }
    if (!field || !scroller) return;
    this.padded ??= {
      element: scroller,
      own: parseFloat(view.getComputedStyle(scroller).paddingBottom) || 0,
    };
    scroller.style.paddingBottom = `${this.padded.own + height}px`;
    scroller.scrollTop += revealBy(field.getBoundingClientRect(), viewport);
  }
}
