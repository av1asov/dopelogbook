import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Photo } from './photo';

const CLOSE_DISTANCE = 90;

/** Full-screen target photo; closes with a swipe down. Pinch zoom stays available. */
@Component({
  selector: 'app-photo-viewer',
  imports: [Photo],
  template: `
    <div
      class="viewer"
      role="dialog"
      aria-label="Фото мишени"
      [style.transform]="'translateY(' + offset() + 'px)'"
      (touchstart)="start($event)"
      (touchmove)="move($event)"
      (touchend)="end()"
      (touchcancel)="reset()"
    >
      <app-photo class="image" [photoId]="photoId()" />
      <button type="button" class="close" aria-label="Закрыть" (click)="closed.emit()">✕</button>
    </div>
  `,
  styles: `
    .viewer {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px);
      background: #0a0c0a;
      touch-action: pinch-zoom;
    }

    .image {
      --photo-fit: contain;
      flex: 1;
      min-width: 0;
    }

    .close {
      position: absolute;
      top: calc(8px + env(safe-area-inset-top, 0px));
      right: 8px;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 50%;
      background: rgb(255 255 255 / 20%);
      color: #fff;
      font-size: 18px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewer {
  readonly photoId = input.required<string>();
  readonly closed = output<void>();

  protected readonly offset = signal(0);
  private startY: number | null = null;

  protected start(event: TouchEvent): void {
    this.startY = event.touches.length === 1 ? event.touches[0].clientY : null;
  }

  protected move(event: TouchEvent): void {
    if (this.startY === null) return;
    if (event.touches.length > 1) {
      this.reset();
      return;
    }
    this.offset.set(Math.max(0, event.touches[0].clientY - this.startY));
  }

  protected end(): void {
    if (this.offset() > CLOSE_DISTANCE) this.closed.emit();
    this.reset();
  }

  protected reset(): void {
    this.startY = null;
    this.offset.set(0);
  }
}
