import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  FitRef,
  fmt,
  fmtSigned,
  plural,
  shortDate,
  V0Info,
  VelocityFit,
} from '../../core/ballistics';

/** V₀ fitted from the journal: the result, how well each series agrees, and saving it. */
@Component({
  selector: 'app-velocity-fit-sheet',
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <section class="sheet" role="dialog" aria-label="Скорость по журналу">
      <span class="handle"></span>
      <div class="head"><h2>Скорость по журналу</h2></div>

      <div class="result">
        <b class="num">V₀ ≈ {{ v0Text() }} ± {{ errorText() }} м/с</b>
        <span>{{ basis() }}</span>
      </div>

      @if (fit().short) {
        <p class="warn">
          Только до {{ fit().maxD }} м — точность ±15–20 м/с. Добавьте серии на 400–500 м.
        </p>
      }

      <div class="group">
        <span class="section-title">Журнал − расчёт, мрад</span>
        @for (row of residuals(); track $index) {
          <div class="residual num">
            <span>{{ row.label }}</span>
            <span>{{ row.value }}</span>
          </div>
        }
      </div>

      <p class="hint">
        Поправка каждой серии с учётом СТП и погоды того дня; БК не меняется. Учтены серии с 200 м и
        дальше, с устойчивых положений.
      </p>

      @if (v0()?.source === 'manual') {
        <p class="note">
          Сейчас вручную: {{ v0()?.value }} м/с ({{ difference() }}). Ручная скорость главнее —
          подбор её не заменяет.
        </p>
        <button type="button" class="btn" (click)="closed.emit()">Закрыть</button>
      } @else {
        <button type="button" class="btn-mark" (click)="save.emit(fit().v0)">
          Сохранить как V₀ связки
        </button>
        <button type="button" class="btn" (click)="closed.emit()">Не сейчас</button>
      }
    </section>
  `,
  styleUrls: ['../range/series-picker.css'],
  styles: `
    .result {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .result b {
      font-size: 24px;
    }

    .result span,
    .hint {
      color: var(--ink-2);
      font-size: 14px;
    }

    .warn,
    .note {
      margin: 0;
      padding: 4px 8px;
      border-left: 3px solid var(--warn);
      color: var(--warn);
      font-size: 14px;
    }

    .note {
      border-color: var(--ink-2);
      color: var(--ink);
    }

    .hint {
      margin: 0;
    }

    .residual {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid var(--rule);
      font-size: 15px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VelocityFitSheet {
  readonly fit = input.required<VelocityFit>();
  readonly v0 = input<V0Info | null>(null);
  readonly save = output<number>();
  readonly closed = output<void>();

  protected readonly v0Text = computed(() => fmt(this.fit().v0, 0));
  protected readonly errorText = computed(() => fmt(Math.max(1, this.fit().error), 0));

  /** «по 5 сериям (200–300 м)» */
  protected readonly basis = computed(() => {
    const { n, minD, maxD } = this.fit();
    const range = minD === maxD ? `${minD} м` : `${minD}–${maxD} м`;
    return `по ${n} ${plural(n, 'серии', 'сериям', 'сериям')} (${range})`;
  });

  protected readonly residuals = computed(() =>
    this.fit().residuals.map((r) => {
      const ref = r.ref as FitRef | undefined;
      return {
        label: [ref ? shortDate(ref.date) : '', `${r.d} м`, ref ? `серия ${ref.si + 1}` : '']
          .filter(Boolean)
          .join(' · '),
        value: fmtSigned(r.residual, 2),
      };
    }),
  );

  protected readonly difference = computed(() => {
    const v0 = this.v0();
    if (!v0) return '';
    const diff = this.fit().v0 - v0.value;
    return `журнал ${diff >= 0 ? 'на ' + fmt(diff, 0) + ' быстрее' : 'на ' + fmt(-diff, 0) + ' медленнее'}`;
  });
}
