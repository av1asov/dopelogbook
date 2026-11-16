import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** «3 ч · справа»: the hour the wind blows from and the side it pushes from. */
export function clockText(hour: number): string {
  const side = hour === 12 ? 'в лицо' : hour === 6 ? 'в спину' : hour < 6 ? 'справа' : 'слева';
  return `${hour} ч · ${side}`;
}

/**
 * A clock face with the wind hour marked and an arrow along the wind. With `pickable`
 * every hour is a button: 12 is into the face, 6 from behind.
 */
@Component({
  selector: 'app-wind-clock',
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + size() + ' ' + size()"
      [attr.width]="size()"
      [attr.height]="size()"
      aria-hidden="true"
    >
      <circle [attr.cx]="c()" [attr.cy]="c()" [attr.r]="c() - 2" class="rim" />
      <path [attr.d]="arrow()" class="arrow" />
      @for (h of hours(); track h.hour) {
        <circle
          [attr.cx]="h.x"
          [attr.cy]="h.y"
          [attr.r]="h.hour === clock() ? big() : small()"
          [class.on]="h.hour === clock()"
        />
        @if (pickable()) {
          <text
            [attr.x]="h.x"
            [attr.y]="h.y + 5"
            text-anchor="middle"
            [class.on]="h.hour === clock()"
          >
            {{ h.hour }}
          </text>
        }
      }
    </svg>
    @if (pickable()) {
      @for (h of hours(); track h.hour) {
        <button
          type="button"
          class="hour"
          [style.left.px]="h.x - 22"
          [style.top.px]="h.y - 22"
          [attr.aria-label]="clockText(h.hour)"
          [attr.aria-pressed]="h.hour === clock()"
          (click)="pick.emit(h.hour)"
        ></button>
      }
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
      flex: none;
      line-height: 0;
    }

    .rim {
      fill: none;
      stroke: var(--rule);
    }

    circle:not(.rim) {
      fill: var(--ink);
    }

    circle.on {
      fill: var(--mark);
      stroke: var(--ink);
      stroke-width: 1.2;
    }

    text {
      fill: var(--card-paper);
      font-family: var(--f-num);
      font-size: 13px;
      font-weight: 700;
    }

    text.on {
      fill: var(--mark-ink);
    }

    .arrow {
      fill: none;
      stroke: var(--ink);
      stroke-width: 1.6;
    }

    .hour {
      position: absolute;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WindClock {
  readonly clock = input.required<number>();
  readonly size = input(36);
  readonly pickable = input(false);
  readonly pick = output<number>();

  protected readonly clockText = clockText;
  protected readonly c = computed(() => this.size() / 2);
  private readonly radius = computed(() => this.c() * (this.pickable() ? 0.8 : 0.72));
  protected readonly small = computed(() => (this.pickable() ? 13 : this.size() * 0.045));
  protected readonly big = computed(() => (this.pickable() ? 16 : this.size() * 0.085));

  protected readonly hours = computed(() =>
    Array.from({ length: 12 }, (_, i) => {
      const hour = i + 1;
      const a = (hour * Math.PI) / 6;
      return {
        hour,
        x: this.c() + this.radius() * Math.sin(a),
        y: this.c() - this.radius() * Math.cos(a),
      };
    }),
  );

  /** From the wind's hour across the centre, with the head where the wind goes. */
  protected readonly arrow = computed(() => {
    const a = (this.clock() * Math.PI) / 6;
    const c = this.c();
    const r = this.radius() * (this.pickable() ? 0.6 : 0.75);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const x1 = c + r * dx;
    const y1 = c + r * dy;
    const x2 = c - r * dx;
    const y2 = c - r * dy;
    const head = r * 0.4;
    const side = (turn: number) => {
      const ux = dx * Math.cos(turn) - dy * Math.sin(turn);
      const uy = dx * Math.sin(turn) + dy * Math.cos(turn);
      return `${(x2 + head * ux).toFixed(1)} ${(y2 + head * uy).toFixed(1)}`;
    };
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}M${side(0.6)}L${x2.toFixed(1)} ${y2.toFixed(1)}L${side(-0.6)}`;
  });
}
