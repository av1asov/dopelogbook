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

/** Heights over the line of sight, mm. */
export interface ChartPoint {
  d: number;
  h: number;
}

/** A journal measurement moved to the chosen zero: where the bullet really went. */
export interface ChartFact {
  d: number;
  h: number;
  /** Half the whisker, mm. */
  spread: number;
}

const W = 361;
const LEFT = 24;
const RIGHT = 349;
const MID = 70;
const TOP = 8;
const BOTTOM = 132;
/** The zone is always drawn this many pixels from the line to its edge. */
const ZONE_PX = 26;
const TWEEN_MS = 200;

/** The trajectory against the kill zone, with the marks of the chosen zero. */
@Component({
  selector: 'app-mpbr-chart',
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' 150'" width="100%" role="img" [attr.aria-label]="label()">
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
      @for (p of crossings(); track $index) {
        <circle class="cross" [attr.cx]="x(p.d)" [attr.cy]="MID" r="3.5" />
        <text
          class="mark"
          [attr.x]="x(p.d)"
          [attr.y]="p.below ? MID + 16 : MID - 8"
          text-anchor="middle"
        >
          {{ p.text }}
        </text>
      }
      @if (peak(); as p) {
        <circle class="hot" [attr.cx]="x(p.d)" [attr.cy]="clampY(p.h)" r="4.5" />
        <text
          class="mark hot-text"
          [attr.x]="x(p.d)"
          [attr.y]="clampY(p.h) - 9"
          text-anchor="middle"
        >
          {{ p.text }}
        </text>
      }
      @if (exit(); as e) {
        <circle class="hot" [attr.cx]="x(e.d)" [attr.cy]="y(-radius())" r="4.5" />
        <text
          class="mark hot-text"
          [attr.x]="x(e.d) + (e.d > axis() * 0.75 ? -6 : 6)"
          [attr.y]="y(-radius()) + 15"
          [attr.text-anchor]="e.d > axis() * 0.75 ? 'end' : 'start'"
        >
          {{ e.text }}
        </text>
      }
      @for (f of facts(); track f.d) {
        <line
          class="whisker"
          [attr.x1]="x(f.d)"
          [attr.y1]="clampY(f.h + f.spread)"
          [attr.x2]="x(f.d)"
          [attr.y2]="clampY(f.h - f.spread)"
        />
        <rect
          class="fact"
          [attr.x]="x(f.d) - 4"
          [attr.y]="clampY(f.h) - 4"
          width="8"
          height="8"
          [attr.transform]="'rotate(45 ' + x(f.d) + ' ' + clampY(f.h) + ')'"
        />
        @if (f.outside) {
          <text
            class="fact-text"
            [attr.x]="x(f.d) - 9"
            [attr.y]="clampY(f.h) + 12"
            text-anchor="end"
          >
            журнал {{ f.text }}
          </text>
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
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

    .mark {
      fill: var(--ink);
      font-family: var(--f-body);
      font-size: 11px;
      font-weight: 700;
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

    .fact-text {
      fill: var(--ok);
      font-family: var(--f-body);
      font-size: 10px;
      font-weight: 700;
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
  /** The optimal zero, dashed, when another one is chosen. */
  readonly ghostPoints = input<ChartPoint[] | null>(null);
  readonly journal = input<ChartFact[]>([]);

  protected readonly W = W;
  protected readonly LEFT = LEFT;
  protected readonly RIGHT = RIGHT;
  protected readonly TOP = TOP;
  protected readonly BOTTOM = BOTTOM;
  protected readonly MID = MID;
  protected readonly ZONE_PX = ZONE_PX;

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
    return LEFT + ((RIGHT - LEFT) * d) / this.axis();
  }

  protected y(h: number): number {
    return MID - (h * ZONE_PX) / this.radius();
  }

  protected clampY(h: number): number {
    return Math.min(BOTTOM, Math.max(TOP, this.y(h)));
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

  protected readonly crossings = computed(() => {
    const { near, far } = this.line();
    return [near, far].flatMap((d, i) =>
      d != null && d <= this.axis() ? [{ d, text: fmt(d, 0), below: i === 0 }] : [],
    );
  });

  protected readonly peak = computed(() => {
    const { peak, above } = this.line();
    if (peak.d <= 0) return null;
    const text = above
      ? `над зоной ${fmt(above[0], 0)}–${fmt(above[1], 0)}`
      : `${fmtSigned(peak.h / 10, 1)} на ${fmt(peak.d, 0)}`;
    return { d: peak.d, h: peak.h, text };
  });

  protected readonly exit = computed(() => {
    const { mpbr, above } = this.line();
    return mpbr != null && mpbr <= this.axis() && !above
      ? { d: mpbr, text: `MPBR ${fmt(mpbr, 0)}` }
      : null;
  });

  protected readonly facts = computed(() => {
    const r = this.radius();
    return this.journal()
      .filter((f) => f.d <= this.axis())
      .map((f) => ({
        ...f,
        outside: Math.abs(f.h) > r,
        text: fmtSigned(f.h / 10, 1),
      }));
  });

  protected readonly label = computed(() => {
    const { near, far, peak, mpbr } = this.line();
    return [
      'Траектория',
      near != null ? `пересекает линию прицеливания на ${fmt(near, 0)}` : '',
      far != null ? `и ${fmt(far, 0)} м` : '',
      `максимум ${fmtSigned(peak.h / 10, 1)} см на ${fmt(peak.d, 0)} м`,
      mpbr != null ? `выходит из зоны на ${fmt(mpbr, 0)} м` : '',
    ]
      .filter(Boolean)
      .join(', ');
  });
}
