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
import { Grabbable, HOLD_MS, MarkEvent, MarkGesture } from '../core/target/mark-gesture';

export type MarkerKind =
  | 'found'
  | 'manual'
  | 'doubt'
  | 'cold'
  | 'aim'
  | 'point'
  | 'centre'
  | 'frame'
  | 'number'
  | 'corner'
  | 'handle'
  | 'ring';

export interface Marker extends Point {
  kind: MarkerKind;
  /** Radius in image pixels, or half the side of a frame. */
  r?: number;
  /** The digit of a `number` marker. */
  label?: string;
  /** Set on a mark a finger can take hold of; the events tell which one by this id. */
  grab?: number;
  /** Can be dragged but not taken away by holding. */
  fixed?: boolean;
  selected?: boolean;
}

export interface Segment {
  a: Point;
  b: Point;
  kind: 'scale' | 'ruler' | 'spread' | 'group' | 'offset' | 'edge';
  label?: string;
}

export interface TargetTap {
  at: Point;
  /** How far from a mark a touch still means that mark, in image pixels. */
  reach: number;
}

export interface MarkMove {
  id: number;
  at: Point;
}

const LOUPE_PX = 96;
const LOUPE_ZOOM = 3;
const LOUPE_GAP = 28;
const LOUPE_MARGIN = 4;
const MAX_ZOOM = 10;
const DOUBLE_TAP_MS = 300;
const TAP_MS = 250;
const TAP_SLOP = 12;
/** A double tap away from any group zooms this much. */
const TAP_ZOOM = 2.5;
/** Room around the group zoomed to, as a share of its size. */
const FOCUS_MARGIN = 0.8;

/** A box on the image, in its pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A photo with marks on top: one finger marks, two fingers pinch and pan. See mark-gesture. */
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
            [class.ruler]="s.kind === 'ruler'"
            [class.group]="s.kind === 'group'"
            [attr.stroke-width]="s.kind === 'group' ? unit() * 4 : null"
            [attr.x]="(s.a.x + s.b.x) / 2"
            [attr.y]="(s.a.y + s.b.y) / 2 - unit() * 8"
            [attr.font-size]="unit() * 13"
          >
            {{ label }}
          </text>
        }
      }
      @for (m of shown(); track $index) {
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
        @if (m.selected) {
          <circle
            class="selected"
            [attr.cx]="m.x"
            [attr.cy]="m.y"
            [attr.r]="(m.r ?? unit() * 9) + unit() * 6"
          />
        }
      }
    </svg>
    @if (loupeAt(); as at) {
      <svg
        class="loupe"
        [style.left.px]="loupeLeft()"
        [style.top.px]="loupeTop()"
        [attr.viewBox]="loupeBox()"
        aria-hidden="true"
      >
        <image [attr.href]="src()" [attr.width]="width()" [attr.height]="height()" />
        @if (draggedMark(); as m) {
          <circle
            [attr.class]="m.kind"
            [attr.cx]="at.x"
            [attr.cy]="at.y"
            [attr.r]="m.r ?? unit() * 5"
          />
        }
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
  /** The loupe is switched on for marks being placed; a dragged mark always gets it. */
  readonly loupe = input(false);
  /** No room for another mark: a touch on empty space asks `refused`. */
  readonly full = input(false);
  /** Width over height of the frame. */
  readonly aspect = input(1);
  /** A double tap fits the photo back or zooms to this box (to the tap, without one). */
  readonly zoomOnDoubleTap = input(false);
  readonly focus = input<Box | null>(null);

  readonly added = output<TargetTap>();
  readonly refused = output<void>();
  readonly selected = output<number>();
  readonly moved = output<MarkMove>();
  readonly removed = output<number>();

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

  private readonly draggedId = signal<number | null>(null);
  /** The dragged mark is drawn in the loupe: under the finger it could not be seen anyway. */
  protected readonly shown = computed(() => {
    const dragged = this.draggedId();
    return dragged == null ? this.markers() : this.markers().filter((m) => m.grab !== dragged);
  });
  protected readonly draggedMark = computed(
    () => this.markers().find((m) => m.grab != null && m.grab === this.draggedId()) ?? null,
  );

  protected readonly loupeAt = signal<Point | null>(null);
  protected readonly loupeLeft = signal(0);
  protected readonly loupeTop = signal(0);
  private readonly loupeSide = computed(() => (LOUPE_PX * this.unit()) / LOUPE_ZOOM);
  protected readonly loupeBox = computed(() => {
    const at = this.loupeAt() as Point;
    const s = this.loupeSide();
    return `${at.x - s / 2} ${at.y - s / 2} ${s} ${s}`;
  });

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: MarkGesture | null = null;
  private pinch: { gap: number; mid: Point; view: { cx: number; cy: number; s: number } } | null =
    null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private press: { x: number; y: number; t: number } | null = null;
  private lastTap: { x: number; y: number; t: number } | null = null;

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
    this.press =
      this.pointers.size === 1 ? { x: event.clientX, y: event.clientY, t: event.timeStamp } : null;
    if (this.pointers.size === 2) {
      this.endGesture();
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    const grabbable = this.markers().flatMap((m): Grabbable[] =>
      m.grab == null ? [] : [{ x: m.x, y: m.y, id: m.grab, fixed: m.fixed }],
    );
    const gesture = new MarkGesture(
      grabbable,
      this.toImage(event.clientX, event.clientY),
      this.unit(),
      event.timeStamp,
      {
        full: this.full(),
        aiming: this.loupe(),
        bounds: { w: this.width(), h: this.height() },
      },
    );
    this.gesture = gesture;
    this.showLoupe(event);
    if (gesture.holdable) {
      this.timer = setTimeout(() => {
        this.emit(gesture.hold());
        this.endGesture();
      }, HOLD_MS);
    }
  }

  protected move(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch) {
      this.updatePinch();
      return;
    }
    const gesture = this.gesture;
    if (!gesture) return;
    const at = this.toImage(event.clientX, event.clientY);
    const change = gesture.move(at, event.timeStamp);
    if (gesture.draggedId != null) clearTimeout(this.timer);
    this.draggedId.set(gesture.draggedId);
    this.emit(change);
    this.showLoupe(event);
  }

  protected up(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    clearTimeout(this.timer);
    if (this.zoomOnDoubleTap() && this.isTap(event)) {
      this.endGesture();
      return;
    }
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const gesture = this.gesture;
    this.endGesture();
    if (gesture) this.emit(gesture.up());
  }

  protected cancel(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    clearTimeout(this.timer);
    this.endGesture();
    this.pinch = null;
  }

  /** A short touch that hardly moved; the second one in a row zooms. */
  private isTap(event: PointerEvent): boolean {
    const press = this.press;
    this.press = null;
    if (this.pinch || !press || this.pointers.size) return false;
    const still = Math.hypot(event.clientX - press.x, event.clientY - press.y) < TAP_SLOP;
    if (!still || event.timeStamp - press.t > TAP_MS) return false;
    const last = this.lastTap;
    const second =
      last &&
      event.timeStamp - last.t < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < TAP_SLOP * 3;
    if (!second) {
      this.lastTap = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      return true;
    }
    this.lastTap = null;
    this.toggleZoom(this.toImage(event.clientX, event.clientY));
    return true;
  }

  /** Back to the whole photo, or in: to the focus box, or to the point tapped. */
  private toggleZoom(at: Point): void {
    const whole = this.side();
    if (this.view().s < whole * 0.98) {
      this.view.set({ cx: this.width() / 2, cy: this.height() / 2, s: whole });
      return;
    }
    const focus = this.focus();
    const centre = focus ? { x: focus.x + focus.w / 2, y: focus.y + focus.h / 2 } : at;
    const fitted = focus
      ? Math.max(focus.w, focus.h * this.aspect()) * (1 + FOCUS_MARGIN)
      : whole / TAP_ZOOM;
    const s = Math.min(whole, Math.max(whole / MAX_ZOOM, fitted));
    this.view.set({
      cx: this.clamp(centre.x, this.width(), s),
      cy: this.clamp(centre.y, this.height(), s / this.aspect()),
      s,
    });
  }

  private endGesture(): void {
    this.gesture = null;
    this.draggedId.set(null);
    this.loupeAt.set(null);
  }

  private emit(event: MarkEvent | null): void {
    switch (event?.type) {
      case 'add':
        this.added.emit({ at: event.at, reach: event.reach });
        break;
      case 'refuse':
        this.refused.emit();
        break;
      case 'select':
        this.selected.emit(event.id);
        break;
      case 'move':
        this.moved.emit({ id: event.id, at: event.at });
        break;
      case 'remove':
        this.removed.emit(event.id);
        break;
    }
  }

  /** Above the finger, or below it when there is no room above. */
  private showLoupe(event: PointerEvent): void {
    const at = this.gesture?.lens ?? null;
    this.loupeAt.set(at);
    if (!at) return;
    const box = this.svg().nativeElement.getBoundingClientRect();
    const [x, y] = [event.clientX - box.left, event.clientY - box.top];
    const above = y - LOUPE_GAP - LOUPE_PX;
    this.loupeLeft.set(
      Math.min(box.width - LOUPE_PX - LOUPE_MARGIN, Math.max(LOUPE_MARGIN, x - LOUPE_PX / 2)),
    );
    this.loupeTop.set(above >= LOUPE_MARGIN ? above : y + LOUPE_GAP);
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
