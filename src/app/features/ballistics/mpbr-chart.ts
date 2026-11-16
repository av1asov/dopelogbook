import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { fmt, fmtSigned, MpbrLine } from '../../core/ballistics';
import {
  CHART,
  ChartFact,
  chartLayout,
  ChartPoint,
  clampY,
  entryText,
  LabelKind,
  xOf,
  yOf,
} from './mpbr-labels';

export type { ChartFact, ChartPoint } from './mpbr-labels';

const { W, LEFT, RIGHT, MID, TOP, BOTTOM, ZONE_PX } = CHART;
const TWEEN_MS = 200;

const LABEL_CLASS: Record<LabelKind, string> = {
  mpbr: 'mark hot-text',
  peak: 'mark hot-text',
  far: 'mark',
  near: 'mark',
  ghost: 'mark ghost-text',
};

/** The trajectory against the kill zone, with the marks of the chosen zero. */
@Component({
  selector: 'app-mpbr-chart',
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + W + ' 150'"
      width="100%"
      role="img"
      [attr.aria-label]="label()"
      (click)="picked.set(null)"
    >
      <defs>
        <clipPath id="mpbr-plot">
          <rect
            [attr.x]="LEFT"
            [attr.y]="TOP"
            [attr.width]="RIGHT - LEFT"
            [attr.height]="BOTTOM - TOP"
          />
        </clipPath>
      </defs>
      <rect
        class="zone"
        [attr.x]="LEFT"
        [attr.y]="y(radius())"
        [attr.width]="RIGHT - LEFT"
        [attr.height]="2 * ZONE_PX"
      />
      <line class="los" [attr.x1]="LEFT" [attr.y1]="MID" [attr.x2]="RIGHT" [attr.y2]="MID" />
      @for (tick of ticks(); track tick) {
        <line class="grid" [attr.x1]="x(tick)" y1="8" [attr.x2]="x(tick)" y2="132" />
        <text class="axis" [attr.x]="x(tick)" y="146" text-anchor="middle">{{ tick }}</text>
      }
      <text class="axis" x="2" [attr.y]="y(radius()) + 4">+{{ cm(radius()) }}</text>
      <text class="axis" x="2" [attr.y]="y(-radius()) + 4">−{{ cm(radius()) }}</text>
      <text class="axis" x="6" [attr.y]="MID + 4">0</text>
      <g clip-path="url(#mpbr-plot)">
        @if (ghost(); as path) {
          <path class="ghost" [attr.d]="path" />
        }
        <path class="line" [attr.d]="path()" />
        @if (overPath(); as over) {
          <path class="over" [attr.d]="over" />
        }
      </g>
      @for (p of layout().crossings; track $index) {
        <circle class="cross" [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.r" />
      }
      @if (layout().peak; as p) {
        <circle class="hot" [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.r" />
      }
      @if (layout().exit; as e) {
        <circle class="hot" [attr.cx]="e.x" [attr.cy]="e.y" [attr.r]="e.r" />
      }
      @for (f of layout().facts; track f.d) {
        <line
          class="whisker"
          [attr.x1]="f.x"
          [attr.y1]="f.top"
          [attr.x2]="f.x"
          [attr.y2]="f.bottom"
        />
        <rect
          class="fact"
          [class.on]="picked() === f.d"
          [attr.x]="f.x - 4"
          [attr.y]="f.y - 4"
          width="8"
          height="8"
          [attr.transform]="'rotate(45 ' + f.x + ' ' + f.y + ')'"
        />
        <!-- A finger needs more than the 8 px of the ◆. -->
        <circle
          class="hit"
          [attr.cx]="f.x"
          [attr.cy]="f.y"
          r="16"
          role="button"
          tabindex="0"
          [attr.aria-label]="f.text"
          (click)="pick(f.d, $event)"
          (keydown.enter)="pick(f.d, $event)"
        />
      }
      @for (l of layout().labels; track l.kind + l.x) {
        <text [attr.class]="labelClass[l.kind]" [attr.x]="l.tx" [attr.y]="l.ty">{{ l.text }}</text>
      }
    </svg>
    @if (pickedFact(); as f) {
      <button
        type="button"
        class="bubble"
        [style.transform]="bubbleShift(f)"
        [style.left.%]="(f.x / W) * 100"
        [style.top.%]="(f.y / 150) * 100"
        (click)="picked.set(null)"
      >
        {{ f.text }}
      </button>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }

    svg {
      display: block;
      overflow: visible;
    }

    .zone {
      fill: var(--mark);
      fill-opacity: 0.25;
    }

    .los {
      stroke: var(--ink);
      stroke-width: 1;
    }

    .grid {
      stroke: var(--grid);
    }

    .axis {
      fill: var(--ink-2);
      font-family: var(--f-num);
      font-size: 10px;
    }

    .line,
    .ghost,
    .over {
      fill: none;
      stroke-linejoin: round;
    }

    .line {
      stroke: var(--ink);
      stroke-width: 2.4;
    }

    .ghost {
      stroke: var(--ink-2);
      stroke-width: 1.2;
      stroke-dasharray: 4 3;
    }

    .over {
      stroke: var(--warn);
      stroke-width: 2.6;
    }

    .cross {
      fill: var(--ink);
    }

    .hot {
      fill: var(--warn);
    }

    /* A halo the colour of the card keeps a label readable where a line runs under it. */
    .mark {
      fill: var(--ink);
      font-family: var(--f-body);
      font-size: 11px;
      font-weight: 700;
      paint-order: stroke;
      stroke: var(--card-paper);
      stroke-width: 3px;
      stroke-linejoin: round;
    }

    .hot-text {
      fill: var(--warn);
    }

    .whisker {
      stroke: var(--ok);
      stroke-width: 1.6;
    }

    .fact {
      fill: var(--ok);
      stroke: var(--card-paper);
      stroke-width: 1.2;
    }

    .fact.on {
      stroke: var(--ink);
      stroke-width: 1.6;
    }

    .hit {
      fill: transparent;
      cursor: pointer;
      outline: none;
    }

    /* Over the ◆, kept on the chart near its edges. */
    .bubble {
      position: absolute;
      z-index: 1;
      max-width: 240px;
      width: max-content;
      padding: 6px 9px;
      border: 0;
      border-radius: 8px;
      background: var(--ink);
      color: var(--card-paper);
      font: 600 12px/1.3 var(--f-body);
      text-align: left;
    }

    .ghost-text {
      fill: var(--ink-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MpbrChart {
  /** m */
  readonly axis = input.required<number>();
  /** mm */
  readonly radius = input.required<number>();
  readonly line = input.required<MpbrLine>();
  readonly points = input.required<ChartPoint[]>();
  /** The zero now, dashed, when another row is chosen. */
  readonly ghostPoints = input<ChartPoint[] | null>(null);
  readonly journal = input<ChartFact[]>([]);

  protected readonly W = W;
  protected readonly LEFT = LEFT;
  protected readonly RIGHT = RIGHT;
  protected readonly TOP = TOP;
  protected readonly BOTTOM = BOTTOM;
  protected readonly MID = MID;
  protected readonly ZONE_PX = ZONE_PX;
  protected readonly labelClass = LABEL_CLASS;
  /** The ◆ tapped, by its distance. */
  protected readonly picked = signal<number | null>(null);
  protected readonly pickedFact = computed(
    () => this.layout().facts.find((f) => f.d === this.picked()) ?? null,
  );

  /** Above the ◆, below it near the top; from its left or right side near an edge. */
  protected bubbleShift(f: { x: number; y: number }): string {
    const x = f.x < W / 3 ? '-14px' : f.x > (W * 2) / 3 ? 'calc(-100% + 14px)' : '-50%';
    const y = f.y < 60 ? '12px' : 'calc(-100% - 12px)';
    return `translate(${x}, ${y})`;
  }

  protected pick(d: number, event: Event): void {
    // The tap must not reach the chart, which closes the bubble.
    event.stopPropagation();
    this.picked.update((now) => (now === d ? null : d));
  }

  /** What is drawn now: follows `points` over 200 ms. */
  private readonly shown = signal<ChartPoint[]>([]);
  private frame = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
    effect(() => {
      const target = this.points();
      const from = untracked(this.shown);
      cancelAnimationFrame(this.frame);
      const sameGrid = from.length === target.length && from.every((p, i) => p.d === target[i].d);
      if (!sameGrid || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.shown.set(target);
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / TWEEN_MS);
        const ease = 1 - (1 - t) ** 3;
        this.shown.set(target.map((p, i) => ({ d: p.d, h: from[i].h + (p.h - from[i].h) * ease })));
        if (t < 1) this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  protected x(d: number): number {
    return xOf({ axis: this.axis(), radius: this.radius() }, d);
  }

  protected y(h: number): number {
    return yOf({ axis: this.axis(), radius: this.radius() }, h);
  }

  protected clampY(h: number): number {
    return clampY({ axis: this.axis(), radius: this.radius() }, h);
  }

  protected cm(mm: number): string {
    return fmt(mm / 10, mm % 10 ? 1 : 0);
  }

  private pathOf(points: readonly ChartPoint[]): string {
    return points
      .map((p, i) => `${i ? 'L' : 'M'}${this.x(p.d).toFixed(1)} ${this.y(p.h).toFixed(1)}`)
      .join('');
  }

  protected readonly ticks = computed(() => {
    const step = this.axis() > 320 ? 100 : 50;
    const out: number[] = [];
    for (let d = step; d < this.axis(); d += step) out.push(d);
    return out;
  });

  protected readonly path = computed(() => this.pathOf(this.shown()));

  protected readonly ghost = computed(() => {
    const ghost = this.ghostPoints();
    return ghost ? this.pathOf(ghost) : null;
  });

  /** The part over the zone, in orange. */
  protected readonly overPath = computed(() => {
    const r = this.radius();
    if (!this.line().above) return null;
    const over = this.shown().filter((p) => p.h > r);
    return over.length > 1 ? this.pathOf(over) : null;
  });

  /** Marks and labels for where the curve is going, not where the transition is now. */
  protected readonly layout = computed(() =>
    chartLayout({
      axis: this.axis(),
      radius: this.radius(),
      line: this.line(),
      points: this.points(),
      ghost: this.ghostPoints(),
      journal: this.journal(),
    }),
  );

  protected readonly label = computed(() => {
    const { near, far, peak, mpbr, entry } = this.line();
    return [
      'Траектория',
      near != null ? `пересекает линию прицеливания на ${fmt(near, 0)}` : '',
      far != null ? `и ${fmt(far, 0)} м` : '',
      `максимум ${fmtSigned(peak.h / 10, 1)} см на ${fmt(peak.d, 0)} м`,
      entry != null ? `входит в зону на ${entryText(entry)} м` : '',
      mpbr != null ? `выходит из зоны на ${fmt(mpbr, 0)} м` : '',
    ]
      .filter(Boolean)
      .join(', ');
  });
}
