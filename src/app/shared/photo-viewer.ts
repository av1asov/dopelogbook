import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { PhotoMarks } from '../core/ballistics';
import { DiaryStore } from '../core/data/diary-store';
import { PhotoActions } from './photo-actions';
import { Marker, TargetView } from './target-view';

const CLOSE_DISTANCE = 90;

/** Screen 15г: a target photo with its marks; closes with a swipe down. */
@Component({
  selector: 'app-photo-viewer',
  imports: [PhotoActions, TargetView],
  template: `
    <div
      class="viewer"
      role="dialog"
      aria-label="Фото мишени"
      [style.transform]="'translateY(' + dragged() + 'px)'"
      (touchstart)="start($event)"
      (touchmove)="move($event)"
      (touchend)="end()"
      (touchcancel)="reset()"
    >
      <header>
        <button type="button" class="close" (click)="closed.emit()">Закрыть</button>
        <span class="title">
          <b>{{ heading() }}</b>
          @if (subtitle(); as text) {
            <span>{{ text }}</span>
          }
        </span>
      </header>

      <div class="stage">
        @if (image(); as shot) {
          <app-target-view
            [style.--image-aspect]="shot.width / shot.height"
            [src]="shot.url"
            [width]="shot.width"
            [height]="shot.height"
            [aspect]="shot.width / shot.height"
            [markers]="markers()"
            [zoomMarks]="true"
          />
        }
      </div>

      @if (group() || offsetText()) {
        <p class="result">
          @if (group(); as text) {
            группа <b class="num">{{ text }}</b>
          }
          @if (group() && offsetText()) {
            ·
          }
          @if (offsetText(); as text) {
            СТП <b class="num">{{ text }}</b>
          }
        </p>
      }

      <app-photo-actions
        class="actions"
        [canMeasure]="canMeasure()"
        (measure)="measure.emit()"
        (retake)="retake.emit($event)"
        (remove)="remove.emit()"
      />
    </div>
  `,
  styles: `
    .viewer {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px);
      background: #0f1210;
      color: #f5f6f2;
      touch-action: none;
    }

    header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      padding: 6px 16px;
    }

    .close {
      justify-self: start;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font-size: 16px;
    }

    .title {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 12px;
      color: #b9c2bb;
      text-align: center;
    }

    .title b {
      color: #f5f6f2;
      font-size: 17px;
    }

    .stage {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      min-height: 0;
      margin: 0 16px;
      container-type: size;
    }

    app-target-view {
      width: min(100cqw, 100cqh * var(--image-aspect, 1));
    }

    .result {
      margin: 0;
      padding: 10px 16px 0;
      color: #b9c2bb;
      font-size: 14px;
      text-align: center;
    }

    .result b {
      color: #f5f6f2;
    }

    .actions {
      --action-rule: #56605a;
      --action-danger: #ff8a80;
      --action-danger-rule: #e0665c;
      padding: 12px 16px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewer {
  private readonly store = inject(DiaryStore);

  readonly photoId = input.required<string>();
  readonly marks = input<PhotoMarks>();
  readonly heading = input('Фото мишени');
  readonly subtitle = input('');
  /** «32 мм · 1,1 MOA». */
  readonly group = input('');
  /** «↑4 →3 мм». */
  readonly offsetText = input('');
  readonly canMeasure = input(true);

  readonly closed = output<void>();
  readonly measure = output<void>();
  readonly retake = output<File>();
  readonly remove = output<void>();

  protected readonly image = signal<{ url: string; width: number; height: number } | null>(null);
  protected readonly markers = computed((): Marker[] =>
    (this.marks()?.targets ?? []).flatMap((target) =>
      target.holes.map(({ x, y, cold }) => ({ x, y, kind: cold ? 'cold' : 'found' })),
    ),
  );

  protected readonly dragged = signal(0);
  private startY: number | null = null;

  constructor() {
    effect((onCleanup) => {
      const id = this.photoId();
      this.store.photoRevision();
      let url: string | null = null;
      let cancelled = false;
      void this.load(id).then((loaded) => {
        if (!loaded) return;
        if (cancelled) {
          URL.revokeObjectURL(loaded.url);
          return;
        }
        url = loaded.url;
        this.image.set(loaded);
      });
      onCleanup(() => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      });
    });
  }

  private async load(id: string) {
    const blob = await this.store.getPhoto(id);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    return { url: URL.createObjectURL(blob), width, height };
  }

  protected start(event: TouchEvent): void {
    this.startY = event.touches.length === 1 ? event.touches[0].clientY : null;
  }

  protected move(event: TouchEvent): void {
    if (this.startY === null) return;
    if (event.touches.length > 1) {
      this.reset();
      return;
    }
    this.dragged.set(Math.max(0, event.touches[0].clientY - this.startY));
  }

  protected end(): void {
    if (this.dragged() > CLOSE_DISTANCE) this.closed.emit();
    this.reset();
  }

  protected reset(): void {
    this.startY = null;
    this.dragged.set(0);
  }
}
