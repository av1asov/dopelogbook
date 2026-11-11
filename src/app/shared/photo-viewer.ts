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
import { fmt, PhotoMarks, Point } from '../core/ballistics';
import { DiaryStore } from '../core/data/diary-store';
import { SettingsStore } from '../core/data/settings-store';
import { holeRadiusPx, marksOverlay } from '../core/target/measure';
import { PhotoActions } from './photo-actions';
import { Box, Marker, Segment, TargetView } from './target-view';

const CLOSE_DISTANCE = 90;
const MARKS_SHOWN = 'photoMarksShown';
/** How far the number of a target on a sheet sits from its point of aim, mm. */
const NUMBER_OFFSET_MM = 30;

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
        @if (marks()) {
          <button type="button" class="layer" [attr.aria-pressed]="shown()" (click)="toggleMarks()">
            Разметка{{ shown() ? ' ✓' : '' }}
          </button>
        }
      </header>

      <div class="stage">
        @if (image(); as shot) {
          <app-target-view
            [style.--image-aspect]="shot.width / shot.height"
            [src]="shot.url"
            [width]="shot.width"
            [height]="shot.height"
            [aspect]="shot.width / shot.height"
            [markers]="shown() ? markers() : []"
            [segments]="shown() ? segments() : []"
            [zoomOnDoubleTap]="true"
            [focus]="focus()"
          />
        }
      </div>

      @if (marks()) {
        <div class="legend" aria-hidden="true">
          <span>
            <svg viewBox="0 0 12 12"><path d="M6 0v12M0 6h12" stroke="#f1c40f" /></svg>
            точка прицеливания
          </span>
          <span>
            <svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="#e8743b" /></svg>
            СТП
          </span>
          <span>
            <svg viewBox="0 0 14 12">
              <path d="M1 11L13 1" stroke="#5aa0ff" stroke-dasharray="3 2" />
            </svg>
            группа
          </span>
          <span>щипок — увеличить</span>
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
        } @else if (sheetGroups(); as text) {
          <p class="result">
            группы <b class="num">{{ text }}</b>
          </p>
        }
      } @else {
        <p class="result">
          Не размечено
          @if (canMeasure()) {
            ·
            <button type="button" class="mark-up" (click)="measure.emit()">Разметить ›</button>
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
      gap: 8px;
      padding: 6px 16px;
    }

    .layer {
      justify-self: end;
      min-height: 34px;
      padding: 0 10px;
      border: 1.5px solid #56605a;
      border-radius: 999px;
      background: transparent;
      color: #b9c2bb;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }

    .layer[aria-pressed='true'] {
      border-color: #f1c40f;
      color: #f1c40f;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px 12px;
      padding: 8px 16px 0;
      color: #b9c2bb;
      font-size: 12px;
    }

    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .legend svg {
      width: 12px;
      height: 12px;
      fill: none;
      stroke-width: 2;
    }

    .mark-up {
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #f1c40f;
      font-size: 14px;
      font-weight: 600;
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
  /** Bullet diameter: holes are drawn this size, as on the markup screen. */
  readonly holeMm = input<number>();
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

  private readonly settings = inject(SettingsStore);

  protected readonly image = signal<{ url: string; width: number; height: number } | null>(null);
  /** The marks layer; it is drawn from the stored marks, never into the photo. */
  protected readonly shown = signal(true);
  private readonly overlay = computed(() => {
    const marks = this.marks();
    return marks ? marksOverlay(marks) : [];
  });
  private readonly sheet = computed(() => this.overlay().length > 1);

  protected readonly markers = computed((): Marker[] => {
    const marks = this.marks();
    const holeMm = this.holeMm();
    if (!marks) return [];
    return this.overlay().flatMap((target): Marker[] => {
      const list: Marker[] = target.holes.map(({ x, y, cold }) => ({
        x,
        y,
        r: holeMm ? holeRadiusPx(marks, { x, y }, holeMm) : undefined,
        kind: cold ? 'cold' : 'found',
      }));
      if (target.aim) list.push({ ...target.aim, kind: 'aim' });
      if (target.centre) list.push({ ...target.centre, kind: 'centre' });
      const anchor = target.aim ?? target.centre;
      if (this.sheet() && anchor) {
        const gap = holeRadiusPx(marks, anchor, NUMBER_OFFSET_MM * 2) * Math.SQRT1_2;
        list.push({
          x: anchor.x - gap,
          y: anchor.y - gap,
          kind: 'number',
          label: String(target.n),
        });
      }
      return list;
    });
  });

  protected readonly segments = computed((): Segment[] =>
    this.overlay().flatMap((target): Segment[] => {
      const list: Segment[] = [];
      if (target.pair && target.group != null) {
        const [a, b] = target.pair;
        list.push({ a, b, kind: 'group', label: `${fmt(target.group, 0)} мм` });
      }
      if (target.aim && target.centre)
        list.push({ a: target.aim, b: target.centre, kind: 'offset' });
      return list;
    }),
  );

  /** The holes and the points of aim, for a double tap to zoom to. */
  protected readonly focus = computed((): Box | null => {
    const points: Point[] = this.overlay().flatMap((t) => [...t.holes, ...(t.aim ? [t.aim] : [])]);
    if (!points.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [x, y] = [Math.min(...xs), Math.min(...ys)];
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  });

  /** «1 · 13 мм  2 · 9 мм» under a sheet. */
  protected readonly sheetGroups = computed(() =>
    this.sheet()
      ? this.overlay()
          .filter((t) => t.group != null)
          .map((t) => `${t.n} · ${fmt(t.group, 0)} мм`)
          .join('  ')
      : '',
  );

  protected readonly dragged = signal(0);
  private startY: number | null = null;

  constructor() {
    void this.settings.readSetting<boolean>(MARKS_SHOWN).then((shown) => {
      if (shown === false) this.shown.set(false);
    });
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

  protected toggleMarks(): void {
    const shown = !this.shown();
    this.shown.set(shown);
    void this.settings.writeSetting(MARKS_SHOWN, shown);
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
