import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Point } from '../core/ballistics';

export type MarkerKind =
  'found' | 'manual' | 'doubt' | 'cold' | 'aim' | 'point' | 'centre' | 'frame' | 'number';

export interface Marker extends Point {
  kind: MarkerKind;
  /** Radius in image pixels, or half the side of a frame. */
  r?: number;
  /** The digit of a `number` marker. */
  label?: string;
}

export interface Segment {
  a: Point;
  b: Point;
  kind: 'scale' | 'spread' | 'offset' | 'edge';
  label?: string;
}

export interface TargetTap {
  at: Point;
  /** Where the finger came down: with the loupe the two differ. */
  from: Point;
  /** How far from a mark a touch still means that mark, in image pixels. */
  reach: number;
}

const HOLD_MS = 500;
const MOVE_PX = 10;
const REACH_PX = 24;
const LOUPE_PX = 120;
const LOUPE_ZOOM = 4;
const MAX_ZOOM = 10;

/** A photo with marks on top: one finger marks, two fingers pinch and pan. */
@Component({
  selector: 'app-target-view',
  template: `
    <svg
      #svg
      class="photo"
      role="img"
      aria-label="Фото мишени с разметкой"
      [style.aspect-ratio]="aspect()"
      [attr.viewBox]="viewBox()"
      (pointerdown)="down($event)"
      (pointermove)="move($event)"
      (pointerup)="up($event)"
      (pointercancel)="cancel($event)"
      (contextmenu)="$event.preventDefault()"
    >
      <image [attr.href]="src()" [attr.width]="width()" [attr.height]="height()" />
      @for (s of segments(); track $index) {
        <line
          [attr.class]="s.kind"
          [attr.x1]="s.a.x"
          [attr.y1]="s.a.y"
          [attr.x2]="s.b.x"
          [attr.y2]="s.b.y"
        />
        @if (s.label; as label) {
          <text
            [attr.x]="(s.a.x + s.b.x) / 2"
            [attr.y]="(s.a.y + s.b.y) / 2 - unit() * 8"
            [attr.font-size]="unit() * 13"
          >
            {{ label }}
          </text>
        }
      }
      @for (m of markers(); track $index) {
        @switch (m.kind) {
          @case ('aim') {
            <circle class="aim" [attr.cx]="m.x" [attr.cy]="m.y" [attr.r]="unit() * 13" />
            <path class="aim" [attr.d]="cross(m, 20, false)" />
          }
          @case ('centre') {
            <path class="centre" [attr.d]="cross(m, 6, true)" />
          }
          @case ('frame') {
            <rect
              class="frame"
              [attr.x]="m.x - (m.r ?? 0)"
              [attr.y]="m.y - (m.r ?? 0)"
              [attr.width]="(m.r ?? 0) * 2"
              [attr.height]="(m.r ?? 0) * 2"
            />
          }
          @case ('number') {
            <text class="number" [attr.x]="m.x" [attr.y]="m.y" [attr.font-size]="unit() * 14">
              {{ m.label }}
            </text>
          }
          @default {
            <circle
              [attr.class]="m.kind"
              [attr.cx]="m.x"
              [attr.cy]="m.y"
              [attr.r]="m.r ?? unit() * 9"
            />
          }
        }
      }
    </svg>
    @if (loupeAt(); as at) {
      <svg
        class="loupe"
        [class.right]="loupeRight()"
        [attr.viewBox]="loupeBox()"
        aria-hidden="true"
      >
        <image [attr.href]="src()" [attr.width]="width()" [attr.height]="height()" />
        <path class="hair" [attr.d]="hair(at)" />
      </svg>
    }
  `,
  styleUrl: './target-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetView {
  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly destroyRef = inject(DestroyRef);

  readonly src = input.required<string>();
  readonly width = input.required<number>();
  readonly height = input.required<number>();
  readonly markers = input<readonly Marker[]>([]);
  readonly segments = input<readonly Segment[]>([]);
  readonly loupe = input(false);
  /** Width over height of the frame. */
  readonly aspect = input(1);

  readonly tapped = output<TargetTap>();
  readonly held = output<TargetTap>();

  /** The width of the view that shows the whole picture. */
  private readonly side = computed(() => Math.max(this.width(), this.height() * this.aspect()));
  private readonly view = signal({ cx: 0, cy: 0, s: 1 });
  private readonly screen = signal(361);

  /** Image pixels per screen pixel. */
  protected readonly unit = computed(() => this.view().s / this.screen());
  protected readonly viewBox = computed(() => {
    const { cx, cy, s } = this.view();
    const tall = s / this.aspect();
    return `${cx - s / 2} ${cy - tall / 2} ${s} ${tall}`;
  });

  protected readonly loupeAt = signal<Point | null>(null);
  protected readonly loupeRight = signal(false);
  private readonly loupeSide = computed(() => (LOUPE_PX * this.unit()) / LOUPE_ZOOM);
  protected readonly loupeBox = computed(() => {
    const at = this.loupeAt() as Point;
    const s = this.loupeSide();
    return `${at.x - s / 2} ${at.y - s / 2} ${s} ${s}`;
  });

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private touch: { startX: number; startY: number; from: Point; at: Point; moved: boolean } | null =
    null;
  private pinch: { gap: number; mid: Point; view: { cx: number; cy: number; s: number } } | null =
    null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const [width, height, s] = [this.width(), this.height(), this.side()];
      this.view.set({ cx: width / 2, cy: height / 2, s });
    });
    afterNextRender(() => {
      const element = this.svg().nativeElement;
      const observer = new ResizeObserver(() => {
        if (element.clientWidth) this.screen.set(element.clientWidth);
      });
      observer.observe(element);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  protected cross({ x, y }: Point, size: number, diagonal: boolean): string {
    const d = size * this.unit();
    return diagonal
      ? `M${x - d} ${y - d}L${x + d} ${y + d}M${x + d} ${y - d}L${x - d} ${y + d}`
      : `M${x} ${y - d}V${y + d}M${x - d} ${y}H${x + d}`;
  }

  protected hair({ x, y }: Point): string {
    const d = this.loupeSide() / 2;
    return `M${x} ${y - d}V${y + d}M${x - d} ${y}H${x + d}`;
  }

  private toImage(clientX: number, clientY: number, view = this.view()): Point {
    const box = this.svg().nativeElement.getBoundingClientRect();
    return {
      x: view.cx - view.s / 2 + ((clientX - box.left) / box.width) * view.s,
      y:
        view.cy -
        view.s / this.aspect() / 2 +
        ((clientY - box.top) / box.height) * (view.s / this.aspect()),
    };
  }

  protected down(event: PointerEvent): void {
    this.svg().nativeElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    clearTimeout(this.timer);
    if (this.pointers.size === 2) {
      this.touch = null;
      this.loupeAt.set(null);
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    const from = this.toImage(event.clientX, event.clientY);
    this.touch = { startX: event.clientX, startY: event.clientY, from, at: from, moved: false };
    if (this.loupe()) {
      this.showLoupe(from, event.clientX);
      return;
    }
    this.timer = setTimeout(() => {
      if (!this.touch || this.touch.moved) return;
      this.held.emit(this.tap(this.touch));
      this.touch = null;
    }, HOLD_MS);
  }

  protected move(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch) {
      this.updatePinch();
      return;
    }
    const touch = this.touch;
    if (!touch) return;
    if (Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) > MOVE_PX) {
      touch.moved = true;
      clearTimeout(this.timer);
    }
    touch.at = this.toImage(event.clientX, event.clientY);
    if (this.loupe()) this.showLoupe(touch.at, event.clientX);
  }

  protected up(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    clearTimeout(this.timer);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const touch = this.touch;
    this.touch = null;
    this.loupeAt.set(null);
    if (touch && (!touch.moved || this.loupe())) this.tapped.emit(this.tap(touch));
  }

  protected cancel(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    clearTimeout(this.timer);
    this.touch = null;
    this.pinch = null;
    this.loupeAt.set(null);
  }

  private tap({ at, from }: { at: Point; from: Point }): TargetTap {
    return { at, from, reach: REACH_PX * this.unit() };
  }

  private showLoupe(at: Point, clientX: number): void {
    const box = this.svg().nativeElement.getBoundingClientRect();
    this.loupeRight.set(clientX < box.left + box.width / 2);
    this.loupeAt.set(at);
  }

  private fingers(): { gap: number; x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { gap: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private startPinch(): void {
    const { gap, x, y } = this.fingers();
    this.pinch = { gap, mid: this.toImage(x, y), view: this.view() };
  }

  /** The point between the fingers stays under them. */
  private updatePinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const { gap, x, y } = this.fingers();
    const whole = this.side();
    const s = Math.min(whole, Math.max(whole / MAX_ZOOM, (pinch.view.s * pinch.gap) / gap));
    const box = this.svg().nativeElement.getBoundingClientRect();
    const cx = pinch.mid.x - ((x - box.left) / box.width - 0.5) * s;
    const tall = s / this.aspect();
    const cy = pinch.mid.y - ((y - box.top) / box.height - 0.5) * tall;
    this.view.set({
      cx: this.clamp(cx, this.width(), s),
      cy: this.clamp(cy, this.height(), tall),
      s,
    });
  }

  private clamp(centre: number, length: number, s: number): number {
    if (s >= length) return length / 2;
    return Math.min(length - s / 2, Math.max(s / 2, centre));
  }
}
