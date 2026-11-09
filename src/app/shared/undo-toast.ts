import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

const SHOW_MS = 3000;

/** «Убрано · Вернуть» over the picture, for a moment after a mark is taken away. */
@Component({
  selector: 'app-undo-toast',
  template: `
    @if (text(); as message) {
      <div class="toast" role="status">
        <span>{{ message }}</span>
        <button type="button" (click)="undo()">Вернуть</button>
      </div>
    }
  `,
  styles: `
    .toast {
      position: absolute;
      right: 8px;
      bottom: 8px;
      left: 8px;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 44px;
      padding: 0 4px 0 12px;
      border-radius: 8px;
      background: #1d221f;
      color: #f5f6f2;
      font-size: 15px;
    }

    button {
      min-height: 44px;
      padding: 0 12px;
      border: 0;
      background: transparent;
      color: #f1c40f;
      font-size: 15px;
      font-weight: 700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UndoToast {
  protected readonly text = signal<string | null>(null);
  private restore: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  show(text: string, restore: () => void): void {
    clearTimeout(this.timer);
    this.text.set(text);
    this.restore = restore;
    this.timer = setTimeout(() => this.hide(), SHOW_MS);
  }

  protected undo(): void {
    this.restore?.();
    clearTimeout(this.timer);
    this.hide();
  }

  private hide(): void {
    this.text.set(null);
    this.restore = null;
  }
}
