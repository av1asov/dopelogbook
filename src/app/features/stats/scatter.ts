import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { niceTicks, shortDate } from '../../core/ballistics';

export interface ChartPoint {
  x: number;
  y: number;
  cls: 'c0' | 'c1' | 'c2' | 'c3';
  tip: string;
}

const DAY = 864e5;
const dayLabel = (t: number) => shortDate(new Date(t).toISOString().slice(0, 10));

/** Dot chart with an optional reference line; tapping a dot shows its details. */
@Component({
  selector: 'app-scatter',
  templateUrl: './scatter.html',
  styleUrl: './scatter.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Scatter {
  readonly points = input.required<ChartPoint[]>();
  readonly line = input<{ x: number; y: number }[]>([]);
  readonly xTime = input(false);
  readonly xFormat = input<(v: number) => string>((v) => String(v));
  readonly yFormat = input<(v: number) => string>((v) => String(v));
  readonly yTitle = input('');
  readonly xTitle = input('');
  /** A small preview without axes. */
  readonly compact = input(false);

  protected readonly tip = signal<string | null>(null);

  protected readonly chart = computed(() => {
    const compact = this.compact();
    const W = compact ? 340 : 640;
    const H = compact ? 80 : 262;
    const m = compact ? { l: 8, r: 8, t: 8, b: 6 } : { l: 48, r: 14, t: 26, b: 34 };
    const points = this.points();
    const line = this.line();
    const xTime = this.xTime();
    const xs = [...points, ...line].map((p) => p.x);
    const ys = [...points, ...line].map((p) => p.y);
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (x1 - x0 < (xTime ? 6 * DAY : 1)) {
      const centre = (x0 + x1) / 2;
      const half = xTime ? 4 * DAY : 50;
      x0 = centre - half;
      x1 = centre + half;
    }
    const padX = (x1 - x0) * 0.05;
    x0 -= padX;
    x1 += padX;
    const yTicks = niceTicks(0, Math.max(...ys) * 1.05 || 1, 4);
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];
    const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v: number) => H - m.b - ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b);

    let xTicks: number[];
    if (xTime) {
      const n = Math.min(5, Math.max(2, Math.round((x1 - x0) / DAY)));
      const span = (x1 - x0 - 2 * padX) / (n - 1 || 1);
      xTicks = Array.from({ length: n }, (_, i) => x0 + padX + i * span);
    } else {
      xTicks = niceTicks(x0, x1, 6).filter((v) => v >= x0 && v <= x1);
    }

    return {
      W,
      H,
      left: m.l,
      right: W - m.r,
      top: m.t,
      axisY: H - m.b,
      labelY: H - m.b + 18,
      xTitleY: H - 4,
      grid: yTicks.map((v) => ({ y: Y(v), textY: Y(v) + 4, label: this.yFormat()(v) })),
      xLabels: xTicks.map((v) => ({
        x: X(v),
        label: xTime ? dayLabel(v) : this.xFormat()(v),
      })),
      polyline: line.length > 1 ? line.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ') : '',
      marks: points.map((p) => ({
        ...p,
        cx: X(p.x),
        cy: Y(p.y),
        diamond: `M${X(p.x)} ${Y(p.y) - 6.5}L${X(p.x) + 6.5} ${Y(p.y)}L${X(p.x)} ${Y(p.y) + 6.5}L${X(p.x) - 6.5} ${Y(p.y)}Z`,
      })),
    };
  });
}
