import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { map } from 'rxjs';
import {
  ammoById,
  ammoName,
  dopePoints,
  elevEff,
  firstSeriesDefaults,
  fmt,
  fmtAng,
  fmtTemp,
  groupAng,
  interp,
  nextSeriesDefaults,
  numText,
  offText,
  parseNum,
  plural,
  rifleById,
  Series,
  SeriesDefaults,
  seriesGroupAng,
  seriesStatus,
  Session,
  shortDate,
  stanceName,
  zeroInfo,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { compact } from '../../core/data/legacy';
import { SettingsStore } from '../../core/data/settings-store';
import { shrinkPhoto } from '../../core/image';
import { SignedInput } from '../../shared/signed-input';
import { Stepper } from '../../shared/stepper';
import { SeriesPicker } from './series-picker';

const text = (value = '') => new FormControl(value, { nonNullable: true });
const count = (value: number) => new FormControl(value, { nonNullable: true });
const flag = () => new FormControl(false, { nonNullable: true });

const DIST_STEP = 25;
const WIND_STEP = 1;

interface RangeDraft {
  sessionId: string;
  value: Record<string, unknown>;
  photos: string[];
}

@Component({
  selector: 'app-range-session',
  imports: [ReactiveFormsModule, SeriesPicker, SignedInput, Stepper],
  templateUrl: './range-session.html',
  styleUrl: './range-session.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangeSession implements OnInit {
  private readonly store = inject(DiaryStore);
  private readonly settings = inject(SettingsStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly session = input.required<Session>();

  protected readonly picks = new FormGroup({
    ammoId: text(),
    device: text(),
    pos: text(),
    rest: text(),
  });

  protected readonly form = new FormGroup({
    picks: this.picks,
    dist: text(),
    elev: text(),
    windSpeed: text(),
    windCorr: text(),
    hits: count(5),
    shots: count(5),
    group: text(),
    offUp: text(),
    offRight: text(),
    skip: flag(),
    skipReason: text(),
    cold: flag(),
    coldUp: text(),
    coldRight: text(),
  });

  protected readonly pickerOpen = signal(false);
  protected readonly confirmingFinish = signal(false);
  protected readonly photos = signal<string[]>([]);
  protected readonly photoBusy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly online = signal(navigator.onLine);

  private readonly value = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  protected readonly rifle = computed(() => rifleById(this.store.diary(), this.session().rifleId)!);
  protected readonly units = computed(() => this.rifle().units);
  protected readonly click = computed(() => this.rifle().click || 0.1);
  protected readonly seriesNumber = computed(() => this.session().series.length + 1);
  protected readonly isFirst = computed(() => this.session().series.length === 0);

  private readonly digits = computed(() => {
    const decimals = String(this.click()).split('.')[1]?.length ?? 0;
    return Math.max(1, decimals);
  });

  protected readonly conditions = computed(() => {
    const s = this.session();
    const temp = fmtTemp(s.temp);
    return [s.place, shortDate(s.date), temp].filter(Boolean).join(' · ');
  });

  protected readonly ammoLabel = computed(() =>
    ammoName(ammoById(this.store.diary(), this.value().picks.ammoId)),
  );
  protected readonly stanceLabel = computed(() => {
    const { pos, rest } = this.value().picks;
    return stanceName({ pos: pos as Series['pos'], rest: rest as Series['rest'] }) || 'положение';
  });
  protected readonly deviceLabel = computed(() => this.value().picks.device || 'без устройства');

  protected readonly sourceNote = signal('');

  private readonly draftSeries = computed((): Series => this.toSeries(this.value()));

  protected readonly clicksText = computed(() => {
    const elev = parseNum(this.value().elev);
    return elev == null ? '' : `${Math.round(elev / this.click())} щелч.`;
  });

  /** The side a typed number goes to. It outlasts an empty field, since the keypad has no minus. */
  private windCorrLeft = false;

  protected readonly windCorrText = computed(() => this.value().windCorr.replace(/-/g, ''));

  protected readonly windCorrSide = computed(() => {
    const corr = parseNum(this.value().windCorr);
    if (!corr) return '0 щелч.';
    return corr < 0 ? '← влево' : 'вправо →';
  });

  protected readonly hitsCaption = computed(() => {
    const { hits, shots } = this.value();
    const missed = shots - hits;
    return missed ? `${missed} ${plural(missed, 'промах', 'промаха', 'промахов')}` : 'все';
  });

  protected readonly cardHint = computed(() => {
    const diary = this.store.diary();
    const s = this.session();
    const dist = parseNum(this.value().dist);
    const ammoId = this.value().picks.ammoId;
    if (dist == null || !ammoId) return null;
    const point = interp(dopePoints(diary, s.rifleId, ammoId).elev, dist);
    if (point) {
      return {
        label: `карта на ${dist} м:`,
        value: `${point.exact ? '' : '≈'}${fmt(point.v, this.digits())} ${this.units()}`,
      };
    }
    const zero = zeroInfo(diary, s.rifleId);
    return zero ? { label: 'ноль', value: `${zero.dist} м` } : null;
  });

  protected readonly resultHint = computed(() => {
    const series = this.draftSeries();
    const parts: string[] = [];
    const angle = groupAng(series);
    if (angle != null) {
      const prefix = this.value().cold ? `Группа ${(series.shots ?? 1) - 1} выстр.` : 'Группа';
      parts.push(`${prefix} ${fmtAng(angle, this.settings.groupUnit())}`);
    }
    const status = seriesStatus(series);
    if (status.use) {
      const value = elevEff(series, this.units()) as number;
      return { parts, card: `${fmt(value, this.digits())} ${this.units()}`, why: null };
    }
    return { parts, card: null, why: status.why ?? null };
  });

  protected readonly today = computed(() => {
    const s = this.session();
    const unit = this.settings.groupUnit();
    const units = this.units();
    return s.series
      .map((x, si) => {
        const angle = seriesGroupAng(s, si);
        const cold = s.coldShot?.si === si ? s.coldShot : null;
        const coldOffset =
          cold && (x.dist ?? 0) > 0
            ? offText({ ...x, offUp: cold.offUp, offRight: cold.offRight }, units).replace(
                ` ${units}`,
                '',
              )
            : '';
        return {
          n: si + 1,
          dist: x.dist != null ? `${x.dist} м` : '—',
          elev: fmt(x.elev, this.digits()),
          hits: x.shots ? `${x.hits ?? 0}/${x.shots}` : '—',
          group: angle != null ? fmtAng(angle, unit) : '',
          cold: cold ? `1-й холодный ${coldOffset}`.trim() : '',
          out: seriesStatus(x).use ? '' : 'не в карте',
        };
      })
      .reverse();
  });

  async ngOnInit(): Promise<void> {
    this.form.controls.windCorr.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        const corr = parseNum(value);
        if (corr) this.windCorrLeft = corr < 0;
      });

    const draft = await this.settings.readSetting<RangeDraft>('rangeDraft');
    if (draft?.sessionId === this.session().id) {
      this.form.patchValue(draft.value);
      this.photos.set(draft.photos);
    } else {
      this.applyDefaults();
    }
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.storeDraft());

    const updateOnline = () => this.online.set(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    });
  }

  protected stepDist(direction: number): void {
    const dist = (parseNum(this.form.controls.dist.value) ?? 0) + direction * DIST_STEP;
    this.form.controls.dist.setValue(String(Math.max(0, dist)));
  }

  protected stepElev(direction: number): void {
    const elev = (parseNum(this.form.controls.elev.value) ?? 0) + direction * this.click();
    this.form.controls.elev.setValue(fmt(Number(elev.toFixed(4)), this.digits()));
  }

  protected stepWindSpeed(direction: number): void {
    const speed = (parseNum(this.form.controls.windSpeed.value) ?? 0) + direction * WIND_STEP;
    this.form.controls.windSpeed.setValue(numText(Math.max(0, speed)));
  }

  protected stepWindCorr(direction: number): void {
    const corr = (parseNum(this.form.controls.windCorr.value) ?? 0) + direction * this.click();
    this.form.controls.windCorr.setValue(fmt(Number(corr.toFixed(4)), this.digits()));
  }

  protected editWindCorr(event: Event): void {
    const typed = (event.target as HTMLInputElement).value.replace(/-/g, '');
    this.form.controls.windCorr.setValue(typed && this.windCorrLeft ? `-${typed}` : typed);
  }

  protected stepHits(direction: number): void {
    this.setHits(this.form.controls.hits.value + direction);
  }

  protected stepShots(direction: number): void {
    this.setShots(this.form.controls.shots.value + direction);
  }

  protected typeHits(event: Event): void {
    const input = event.target as HTMLInputElement;
    const typed = parseNum(input.value);
    if (typed != null) this.setHits(Math.round(typed));
    input.value = String(this.form.controls.hits.value);
  }

  protected typeShots(event: Event): void {
    const input = event.target as HTMLInputElement;
    const typed = parseNum(input.value);
    if (typed != null) this.setShots(Math.round(typed));
    input.value = String(this.form.controls.shots.value);
  }

  private setHits(value: number): void {
    const { hits, shots } = this.form.controls;
    hits.setValue(Math.min(shots.value, Math.max(0, value)));
  }

  /** Hits follow the shots while every shot is a hit. */
  private setShots(value: number): void {
    const { hits, shots } = this.form.controls;
    const next = Math.max(1, value);
    const allHit = hits.value === shots.value;
    shots.setValue(next);
    hits.setValue(allHit ? next : Math.min(hits.value, next));
  }

  protected async addPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoBusy.set(true);
    this.error.set(null);
    try {
      const id = await this.store.addPhoto(await shrinkPhoto(file));
      this.photos.update((list) => [...list, id]);
      await this.storeDraft();
    } catch {
      this.error.set('Не удалось сохранить фото.');
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async saveSeries(): Promise<void> {
    const session = this.session();
    const si = session.series.length;
    const v = this.form.getRawValue();
    const series = this.toSeries(v);
    this.error.set(null);
    try {
      await this.store.save('session', {
        ...session,
        series: [...session.series, series],
        photos: [...(session.photos ?? []), ...this.photos().map((id) => ({ id, si }))],
        ...(si === 0 && v.cold
          ? {
              coldShot: compact({
                si,
                offUp: parseNum(v.coldUp),
                offRight: parseNum(v.coldRight),
              }),
            }
          : {}),
      });
    } catch {
      this.error.set('Не удалось сохранить серию.');
      return;
    }
    this.photos.set([]);
    this.resetForm(nextSeriesDefaults(series));
    this.sourceNote.set(`как в серии ${si + 1}`);
    await this.storeDraft();
    document.querySelector('.content')?.scrollTo(0, 0);
  }

  protected async finish(): Promise<void> {
    const { open: _open, ...session } = this.session();
    await this.settings.writeSetting('rangeDraft', null);
    for (const id of this.photos()) await this.store.removePhoto(id);
    if (session.series.length) await this.store.save('session', session);
    else await this.store.remove('session', session.id);
  }

  private applyDefaults(): void {
    const session = this.session();
    const last = session.series.at(-1);
    const defaults = last
      ? nextSeriesDefaults(last)
      : firstSeriesDefaults(this.store.diary(), this.rifle());
    this.resetForm(defaults);
    if (last) this.sourceNote.set(`как в серии ${session.series.length}`);
  }

  private resetForm(defaults: SeriesDefaults): void {
    const shots = defaults.shots ?? 5;
    this.form.reset({
      picks: {
        ammoId: defaults.ammoId,
        device: defaults.device ?? '',
        pos: defaults.pos ?? '',
        rest: defaults.rest ?? '',
      },
      dist: numText(defaults.dist),
      elev: defaults.elev == null ? '' : fmt(defaults.elev, this.digits()),
      hits: shots,
      shots,
    });
  }

  private toSeries(v: ReturnType<typeof this.form.getRawValue>): Series {
    return compact({
      ammoId: v.picks.ammoId,
      device: v.picks.device,
      pos: v.picks.pos as Series['pos'],
      rest: v.picks.rest as Series['rest'],
      dist: parseNum(v.dist),
      elev: parseNum(v.elev),
      windSpeed: parseNum(v.windSpeed),
      windCorr: parseNum(v.windCorr),
      hits: v.hits,
      shots: v.shots,
      group: parseNum(v.group),
      offUp: parseNum(v.offUp),
      offRight: parseNum(v.offRight),
      ...(v.skip ? { skip: true, skipReason: v.skipReason.trim() } : {}),
    });
  }

  private storeDraft(): Promise<void> {
    const draft: RangeDraft = {
      sessionId: this.session().id,
      value: this.form.getRawValue(),
      photos: this.photos(),
    };
    return this.settings.writeSetting('rangeDraft', draft);
  }
}
