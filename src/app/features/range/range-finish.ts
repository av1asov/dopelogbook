import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {
  ammoById,
  ammoChipName,
  ammoName,
  barrelRounds,
  cardUpdates,
  fmt,
  fmtAng,
  scopeById,
  seriesGroupAng,
  Session,
  sessionRounds,
  shortDate,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';

/** «100 м», «100 и 200 м», «100, 200 и 300 м». */
function distList(dists: readonly number[]): string {
  const head = dists.slice(0, -1).join(', ');
  return `${head ? `${head} и ` : ''}${dists.at(-1)} м`;
}

/** Screen 1г: what the day comes to, before the record is closed. */
@Component({
  selector: 'app-range-finish',
  template: `
    <div class="finish-screen" role="dialog" aria-labelledby="finish-title">
      <header>
        <button type="button" class="back" (click)="back.emit()">‹ На рубеж</button>
        <h1 id="finish-title">Завершить стрельбу?</h1>
        <span class="muted">{{ heading() }}</span>
      </header>

      <main>
        @if (filled()) {
          <div class="state ok">
            {{ draftName() }} заполнена — <b>сохранится вместе с завершением</b>.
          </div>
        } @else {
          <div class="state">Незаполненная {{ draftName().toLowerCase() }} не сохранится.</div>
        }

        <div class="tiles">
          <div class="tile">
            <span>серий</span>
            <b class="num">
              {{ totals().normal }}
              @if (totals().zeroing) {
                <small>+{{ totals().zeroing }} пр.</small>
              }
            </b>
          </div>
          <div class="tile">
            <span>выстрелов</span>
            <b class="num">{{ totals().rounds }}</b>
          </div>
          <div class="tile">
            <span>ствол</span>
            <b class="num">{{ totals().barrel }}</b>
          </div>
        </div>

        @if (rows().length) {
          <div class="list">
            @for (row of rows(); track row.si) {
              <div class="row num" [class.new]="row.isNew">
                <span class="muted">{{ row.number }}</span>
                <span>{{ row.dist }}</span>
                <span class="ammo">
                  {{ row.ammo }}
                  @if (row.isNew) {
                    <span class="new-mark">· новая</span>
                  }
                </span>
                <span>{{ row.group }}</span>
              </div>
            }
          </div>
        }

        @for (line of card(); track line.name) {
          <p class="card-line muted">
            В карту <b>{{ line.name }}</b
            >: {{ line.text }}.
          </p>
        } @empty {
          @if (rows().length) {
            <p class="card-line muted">DOPE-карта не изменилась.</p>
          }
        }

        <label class="field notes">
          Заметка к стрельбе
          <textarea rows="3" [value]="notes()" (input)="typeNotes($event)"></textarea>
        </label>

        <div class="actions">
          <button type="button" class="btn-mark" (click)="done.emit(notes())">Завершить</button>
          <button type="button" class="more" (click)="back.emit()">
            Ещё серия — вернуться на рубеж
          </button>
        </div>
      </main>
    </div>
  `,
  styles: `
    .finish-screen {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      background: var(--paper);
      color: var(--ink);
    }

    header {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: calc(var(--top-edge, env(safe-area-inset-top, 0px)) + 6px) 16px 10px;
      background: var(--sheet);
      border-bottom: 1px solid var(--rule);
    }

    .back {
      align-self: flex-start;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--pen);
      font-size: 16px;
      font-weight: 600;
    }

    h1 {
      margin: 0;
      font-family: var(--f-display);
      font-size: 26px;
      font-weight: 800;
    }

    header .muted {
      font-size: 14px;
    }

    main {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      padding: 12px 16px calc(16px + env(safe-area-inset-bottom, 0px));
      overflow-y: auto;
    }

    .state {
      padding: 10px 12px;
      background: var(--sheet);
      border: 1px solid var(--rule);
      border-left: 4px solid var(--ink-2);
      font-size: 15px;
    }

    .state.ok {
      border-left-color: var(--ok);
    }

    .tiles {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .tile {
      display: flex;
      flex-direction: column;
      padding: 6px 8px;
      background: var(--sheet);
      border: 1px solid var(--rule);
    }

    .tile span {
      color: var(--ink-2);
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .tile b {
      font-size: 20px;
    }

    .tile small {
      color: var(--ink-2);
      font-size: 13px;
    }

    .list {
      display: flex;
      flex-direction: column;
      background: var(--sheet);
      border: 1px solid var(--rule);
      font-size: 14px;
    }

    .row {
      display: grid;
      grid-template-columns: 20px 52px minmax(0, 1fr) auto;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--rule);
    }

    .row:last-child {
      border-bottom: 0;
    }

    .row.new {
      background: color-mix(in srgb, var(--ok) 12%, var(--sheet));
    }

    .ammo {
      overflow: hidden;
      font-family: var(--f-body);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .new-mark {
      color: var(--ok);
    }

    .card-line {
      margin: 0;
      font-size: 14px;
    }

    .card-line b {
      color: var(--ink);
    }

    .notes textarea {
      resize: none;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: auto;
    }

    .actions .btn-mark {
      min-height: 52px;
      font-size: 18px;
    }

    .more {
      min-height: 44px;
      border: 0;
      background: transparent;
      color: var(--pen);
      font-size: 16px;
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangeFinish implements OnInit {
  private readonly store = inject(DiaryStore);
  private readonly settings = inject(SettingsStore);

  /** The record as «Завершить» will save it: a filled draft is already its last series. */
  readonly session = input.required<Session>();
  readonly rifleName = input.required<string>();
  readonly filled = input.required<boolean>();
  /** The number the draft has on the range: «Серия 3» or «Пристрелка 2». */
  readonly draftNumber = input.required<number>();
  readonly zeroing = input(false);

  readonly back = output<void>();
  /** With the note to the record. */
  readonly done = output<string>();

  protected readonly notes = signal('');

  protected readonly heading = computed(() => {
    const s = this.session();
    return [s.place, shortDate(s.date), this.rifleName()].filter(Boolean).join(' · ');
  });

  protected readonly draftName = computed(
    () => `${this.zeroing() ? 'Пристрелка' : 'Серия'} ${this.draftNumber()}`,
  );

  protected readonly totals = computed(() => {
    const s = this.session();
    const zeroing = s.series.filter((x) => x.kind === 'zeroing').length;
    return {
      normal: s.series.length - zeroing,
      zeroing,
      rounds: sessionRounds(s),
      barrel: fmt(barrelRounds(this.store.diary(), s), 0),
    };
  });

  protected readonly rows = computed(() => {
    const s = this.session();
    const diary = this.store.diary();
    const unit = this.settings.groupUnit();
    const last = s.series.length - 1;
    let number = 0;
    return s.series.flatMap((x, si) => {
      if (x.kind !== 'normal') return [];
      const angle = seriesGroupAng(s, si);
      return [
        {
          si,
          number: ++number,
          dist: x.dist != null ? `${x.dist} м` : '—',
          ammo: ammoChipName(ammoName(ammoById(diary, x.ammoId))),
          group: angle != null ? fmtAng(angle, unit) : '—',
          isNew: this.filled() && !this.zeroing() && si === last,
        },
      ];
    });
  });

  protected readonly card = computed(() => {
    const diary = this.store.diary();
    return cardUpdates(diary, this.session()).map((update) => {
      const ammo = ammoChipName(ammoName(ammoById(diary, update.ammoId)));
      const scope = scopeById(diary, update.scopeId)?.name;
      const one = update.dists.length === 1;
      return {
        name: [ammo, scope].filter(Boolean).join(' · '),
        text: `${one ? 'обновлена точка' : 'обновлены'} ${distList(update.dists)}`,
      };
    });
  });

  ngOnInit(): void {
    this.notes.set(this.session().notes ?? '');
  }

  protected typeNotes(event: Event): void {
    this.notes.set((event.target as HTMLTextAreaElement).value);
  }
}
