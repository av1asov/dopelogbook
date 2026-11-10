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
  clickOf,
  clicksText,
  dopePoints,
  elevEff,
  finishZeroing,
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
  PhotoRef,
  plural,
  rifleById,
  scopeById,
  Series,
  SeriesDefaults,
  seriesGroupAng,
  seriesStatus,
  Session,
  shortDate,
  stanceName,
  toMrad,
  toUnits,
  unitDigits,
  unitLabel,
  unitsOf,
  zeroInfo,
  ZeroingPlan,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { compact } from '../../core/data/legacy';
import { SettingsStore } from '../../core/data/settings-store';
import { shrinkPhoto } from '../../core/image';
import { withMeasurement } from '../../core/target/measure';
import { MeasureApplied, measureContext, PhotoMeasure } from '../photo-measure/photo-measure';
import { SignedInput } from '../../shared/signed-input';
import { Stepper } from '../../shared/stepper';
import { SeriesPicker } from './series-picker';

const text = (value = '') => new FormControl(value, { nonNullable: true });
const count = (value: number) => new FormControl(value, { nonNullable: true });
const flag = () => new FormControl(false, { nonNullable: true });

const DIST_STEP = 25;
const WIND_STEP = 1;
const ZEROING_SHOTS = 3;
const CAMERA_HINT = 'cameraHintShown';

type DraftPhoto = Omit<PhotoRef, 'si'>;

interface RangeDraft {
  sessionId: string;
  value: Record<string, unknown>;
  /** A plain id in drafts saved before photos could carry marks. */
  photos: (string | DraftPhoto)[];
}

@Component({
  selector: 'app-range-session',
  imports: [PhotoMeasure, ReactiveFormsModule, SeriesPicker, SignedInput, Stepper],
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
    scopeId: text(),
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
    clicksUp: count(0),
    clicksRight: count(0),
  });

  protected readonly pickerOpen = signal(false);
  protected readonly confirmingFinish = signal(false);
  protected readonly photos = signal<DraftPhoto[]>([]);
  /** A new shot being marked up; it reaches the store only when applied or kept. */
  protected readonly measuring = signal<{ id: string; shot: Blob } | null>(null);
  protected readonly cameraHint = signal(false);
  protected readonly photoBusy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly online = signal(navigator.onLine);

  private readonly value = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  protected readonly rifle = computed(() => rifleById(this.store.diary(), this.session().rifleId)!);
  protected readonly scope = computed(() =>
    scopeById(this.store.diary(), this.value().picks.scopeId),
  );
  protected readonly units = computed(() => unitsOf(this.scope()));
  protected readonly unitName = computed(() => unitLabel(this.units()));
  protected readonly click = computed(() => clickOf(this.scope()));
  private readonly digits = computed(() => unitDigits(this.scope()));

  protected readonly zeroing = computed(() => this.session().zeroing ?? null);
  protected readonly seriesNumber = computed(
    () => this.session().series.filter((x) => x.kind === 'normal').length + 1,
  );
  protected readonly zeroingNumber = computed(() => this.zeroingSeries().length + 1);
  /** The cold shot is the first shot of the day; while zeroing it is not recorded. */
  protected readonly isFirst = computed(
    () => this.session().series.length === 0 && !this.zeroing(),
  );

  private readonly zeroingSeries = computed(() =>
    this.session().series.filter((x) => x.kind === 'zeroing'),
  );

  protected readonly zeroingAmmo = computed(() =>
    ammoName(ammoById(this.store.diary(), this.zeroing()?.ammoId)),
  );
  protected readonly zeroingScope = computed(
    () => scopeById(this.store.diary(), this.zeroing()?.scopeId)?.name ?? '',
  );

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
  protected readonly scopeLabel = computed(() => this.scope()?.name ?? 'прицел');

  protected readonly sourceNote = signal('');
  protected readonly absolute = Math.abs;

  private readonly draftSeries = computed((): Series => this.toSeries(this.value()));

  private readonly draftIndex = computed(() => this.session().series.length);

  protected readonly measureContext = computed(() =>
    measureContext(this.store.diary(), this.rifle(), this.session(), {
      si: this.draftIndex(),
      number: this.seriesNumber(),
      draft: this.draftSeries(),
    }),
  );

  protected readonly clicksText = computed(() => {
    const elev = parseNum(this.value().elev);
    if (elev == null) return '';
    const clicks = Math.round(elev / this.click());
    return `${clicks > 0 ? '↑ ' : clicks < 0 ? '↓ ' : ''}${Math.abs(clicks)} щелч.`;
  });

  /** The side a typed number goes to. It outlasts an empty field, since the keypad has no minus. */
  private windCorrLeft = false;

  protected readonly windCorrText = computed(() => this.value().windCorr.replace(/-/g, ''));

  protected readonly windCorrSide = computed(() => {
    const corr = parseNum(this.value().windCorr) ?? 0;
    const clicks = Math.round(corr / this.click());
    return `${clicks > 0 ? '→ ' : clicks < 0 ? '← ' : ''}${Math.abs(clicks)} щелч.`;
  });

  protected readonly zeroingShotsCaption = computed(() => {
    const previous = this.zeroingSeries().at(-1);
    const shots = this.value().shots;
    if (shots === 0) return 'не записывать';
    return previous?.shots === shots ? `как в П${this.zeroingSeries().length}` : '';
  });

  protected readonly clicksUpCaption = computed(() => {
    const clicks = this.value().clicksUp;
    return clicks > 0 ? '↑ вверх' : clicks < 0 ? '↓ вниз' : 'не крутил';
  });

  protected readonly clicksRightCaption = computed(() => {
    const clicks = this.value().clicksRight;
    return clicks > 0 ? 'вправо →' : clicks < 0 ? '← влево' : 'не крутил';
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
    const { ammoId, scopeId } = this.value().picks;
    if (dist == null || !ammoId) return null;
    const point = interp(dopePoints(diary, s.rifleId, scopeId, ammoId).elev, dist);
    if (point) {
      const value = fmt(toUnits(point.v, this.units()), this.digits());
      return {
        label: `карта на ${dist} м:`,
        value: `${point.exact ? '' : '≈'}${value} ${this.unitName()}`,
      };
    }
    const zero = zeroInfo(diary, s.rifleId, scopeId);
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
      const value = toUnits(elevEff(series) as number, this.units());
      return { parts, card: `${fmt(value, this.digits())} ${this.unitName()}`, why: null };
    }
    return { parts, card: null, why: status.why ?? null };
  });

  protected readonly today = computed(() => {
    const s = this.session();
    const diary = this.store.diary();
    const unit = this.settings.groupUnit();
    let normal = 0;
    let zeroing = 0;
    return s.series
      .map((x, si) => {
        if (x.kind === 'zeroing') {
          return {
            si,
            n: `П${++zeroing}`,
            zeroing: true,
            shots: `${x.shots ?? 0} выстр.`,
            clicks: clicksText(x.clicksUp, x.clicksRight),
            dist: '',
            elev: '',
            hits: '',
            group: '',
            cold: '',
            out: '',
          };
        }
        const scope = scopeById(diary, x.scopeId);
        const units = unitsOf(scope);
        const angle = seriesGroupAng(s, si);
        const cold = s.coldShot?.si === si ? s.coldShot : null;
        const coldOffset =
          cold && (x.dist ?? 0) > 0
            ? offText({ ...x, offUp: cold.offUp, offRight: cold.offRight }, units).replace(
                ` ${unitLabel(units)}`,
                '',
              )
            : '';
        return {
          si,
          n: String(++normal),
          zeroing: false,
          shots: '',
          clicks: '',
          dist: x.dist != null ? `${x.dist} м` : '—',
          elev: x.elev == null ? '—' : fmt(toUnits(x.elev, units), unitDigits(scope)),
          hits: x.shots ? `${x.hits ?? 0}/${x.shots}` : '—',
          group: angle != null ? fmtAng(angle, unit) : '',
          cold: cold ? `1-й холодный ${coldOffset}`.trim() : '',
          out: seriesStatus(x).use ? '' : 'не в карте',
        };
      })
      .reverse();
  });

  protected readonly zeroingRows = computed(() => this.today().filter((row) => row.zeroing));
  protected readonly zeroingTotal = computed(() =>
    this.zeroingSeries().reduce((sum, x) => sum + (x.shots ?? 0), 0),
  );

  async ngOnInit(): Promise<void> {
    this.form.controls.windCorr.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        const corr = parseNum(value);
        if (corr) this.windCorrLeft = corr < 0;
      });

    this.cameraHint.set(!(await this.settings.readSetting<boolean>(CAMERA_HINT)));
    const draft = await this.settings.readSetting<RangeDraft>('rangeDraft');
    if (draft?.sessionId === this.session().id) {
      this.form.patchValue(draft.value);
      this.photos.set(draft.photos.map((p) => (typeof p === 'string' ? { id: p } : p)));
      if (!this.picks.controls.scopeId.value) {
        this.picks.controls.scopeId.setValue(this.defaultsFor(this.session()).scopeId);
      }
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

  /** Keeps the angle already entered: the same correction, in the new scope's units. */
  protected changeScope(scopeId: string): void {
    const { elev, windCorr } = this.form.controls;
    const from = this.units();
    this.picks.controls.scopeId.setValue(scopeId);
    const scope = scopeById(this.store.diary(), scopeId);
    const convert = (value: string): string => {
      const parsed = parseNum(value);
      if (parsed == null) return value;
      return fmt(toUnits(toMrad(parsed, from), unitsOf(scope)), unitDigits(scope));
    };
    elev.setValue(convert(elev.value));
    windCorr.setValue(convert(windCorr.value));
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

  protected stepClicksUp(direction: number): void {
    const { clicksUp } = this.form.controls;
    clicksUp.setValue(clicksUp.value + direction);
  }

  protected stepClicksRight(direction: number): void {
    const { clicksRight } = this.form.controls;
    clicksRight.setValue(clicksRight.value + direction);
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
    const next = Math.max(this.zeroing() ? 0 : 1, value);
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
    this.cameraHint.set(false);
    void this.settings.writeSetting(CAMERA_HINT, true);
    try {
      this.measuring.set({ id: crypto.randomUUID(), shot: await shrinkPhoto(file) });
    } catch {
      this.error.set('Не удалось прочитать фото.');
    } finally {
      this.photoBusy.set(false);
    }
  }

  /** «Сохранить фото без разметки»: the photo is already in the store. */
  protected async keepPhoto(id: string): Promise<void> {
    this.measuring.set(null);
    this.photos.update((list) => [...list, { id }]);
    await this.storeDraft();
  }

  protected async applyMeasure(id: string, result: MeasureApplied): Promise<void> {
    const { group, offUp, offRight, cold, coldUp, coldRight } = this.form.controls;
    const draft = this.draftIndex();
    const current = result.results.find((r) => r.si === draft);
    if (result.sheet) {
      // A sheet reaches series already saved, so it joins the record straight away.
      const saved = result.results.filter((r) => r.si !== draft);
      await this.store.save(
        'session',
        withMeasurement(this.session(), { id, marks: result.marks }, saved),
      );
    } else {
      this.photos.update((list) => [...list, { id, marks: result.marks }]);
    }
    if (current?.group != null) group.setValue(numText(current.group));
    if (current?.offset) {
      offUp.setValue(numText(current.offset.offUp));
      offRight.setValue(numText(current.offset.offRight));
    }
    if (result.cold && this.isFirst()) {
      cold.setValue(true);
      coldUp.setValue(numText(result.cold.offUp));
      coldRight.setValue(numText(result.cold.offRight));
    }
    this.measuring.set(null);
    await this.storeDraft();
  }

  protected submit(): Promise<void> {
    return this.zeroing() ? this.recordZeroing() : this.saveSeries();
  }

  protected async recordZeroing(): Promise<void> {
    const session = this.session();
    const series = this.toZeroingSeries(session.zeroing as ZeroingPlan);
    if (!series) return;
    await this.saveAndContinue({ ...session, series: [...session.series, series] });
  }

  /** With the shots at zero nothing new is recorded and the zero follows the last series. */
  protected async zeroSet(): Promise<void> {
    const session = this.session();
    const series = this.toZeroingSeries(session.zeroing as ZeroingPlan);
    await this.saveAndContinue(finishZeroing(session, series));
  }

  private async saveAndContinue(session: Session): Promise<void> {
    this.error.set(null);
    let saved: Session;
    try {
      saved = await this.store.save('session', session);
    } catch {
      this.error.set('Не удалось сохранить серию.');
      return;
    }
    this.resetForm(this.defaultsFor(saved));
    this.sourceNote.set('');
    await this.storeDraft();
    document.querySelector('.content')?.scrollTo(0, 0);
  }

  protected async saveSeries(): Promise<void> {
    const session = this.session();
    const si = session.series.length;
    const number = this.seriesNumber();
    const v = this.form.getRawValue();
    const series = this.toSeries(v);
    this.error.set(null);
    try {
      await this.store.save('session', {
        ...session,
        series: [...session.series, series],
        photos: [...(session.photos ?? []), ...this.photos().map((photo) => ({ ...photo, si }))],
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
    this.sourceNote.set(`как в серии ${number}`);
    await this.storeDraft();
    document.querySelector('.content')?.scrollTo(0, 0);
  }

  protected async finish(): Promise<void> {
    const { open: _open, zeroing: _zeroing, ...session } = this.session();
    await this.settings.writeSetting('rangeDraft', null);
    for (const { id } of this.photos()) await this.store.removePhoto(id);
    if (session.series.length) await this.store.save('session', session);
    else await this.store.remove('session', session.id);
  }

  private applyDefaults(): void {
    const session = this.session();
    this.resetForm(this.defaultsFor(session));
    if (session.series.at(-1)?.kind === 'normal') {
      this.sourceNote.set(`как в серии ${this.seriesNumber() - 1}`);
    }
  }

  private defaultsFor(session: Session): SeriesDefaults {
    const last = session.series.at(-1);
    const base = last
      ? nextSeriesDefaults(last)
      : firstSeriesDefaults(this.store.diary(), this.rifle());
    const plan = session.zeroing;
    if (!plan) return base;
    const shots = last?.kind === 'zeroing' ? (last.shots ?? ZEROING_SHOTS) : ZEROING_SHOTS;
    return { ...base, ...plan, shots };
  }

  private resetForm(defaults: SeriesDefaults): void {
    const shots = defaults.shots ?? 5;
    const scope = scopeById(this.store.diary(), defaults.scopeId);
    this.form.reset({
      picks: {
        scopeId: defaults.scopeId,
        ammoId: defaults.ammoId,
        device: defaults.device ?? '',
        pos: defaults.pos ?? '',
        rest: defaults.rest ?? '',
      },
      dist: numText(defaults.dist),
      elev:
        defaults.elev == null ? '' : fmt(toUnits(defaults.elev, unitsOf(scope)), unitDigits(scope)),
      hits: shots,
      shots,
    });
  }

  private toSeries(v: ReturnType<typeof this.form.getRawValue>): Series {
    const units = unitsOf(scopeById(this.store.diary(), v.picks.scopeId));
    const angle = (value: string): number | null => {
      const parsed = parseNum(value);
      return parsed == null ? null : toMrad(parsed, units);
    };
    return compact({
      kind: 'normal' as const,
      scopeId: v.picks.scopeId,
      ammoId: v.picks.ammoId,
      device: v.picks.device,
      pos: v.picks.pos as Series['pos'],
      rest: v.picks.rest as Series['rest'],
      dist: parseNum(v.dist),
      elev: angle(v.elev),
      windSpeed: parseNum(v.windSpeed),
      windCorr: angle(v.windCorr),
      hits: v.hits,
      shots: v.shots,
      group: parseNum(v.group),
      offUp: parseNum(v.offUp),
      offRight: parseNum(v.offRight),
      ...(v.skip ? { skip: true, skipReason: v.skipReason.trim() } : {}),
    });
  }

  /** Null when the shots are at zero, which means there is nothing to record. */
  private toZeroingSeries(plan: ZeroingPlan): Series | null {
    const v = this.form.getRawValue();
    if (!v.shots) return null;
    return compact({
      kind: 'zeroing' as const,
      scopeId: plan.scopeId,
      ammoId: plan.ammoId,
      device: v.picks.device,
      pos: v.picks.pos as Series['pos'],
      rest: v.picks.rest as Series['rest'],
      dist: plan.dist,
      shots: v.shots,
      clicksUp: v.clicksUp || null,
      clicksRight: v.clicksRight || null,
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
