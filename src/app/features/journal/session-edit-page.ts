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
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { map, pairwise, startWith } from 'rxjs';
import {
  afterSeriesRemoved,
  ammoById,
  ammoName,
  ColdShot,
  devName,
  firstSeriesDefaults,
  mainScope,
  mountsOf,
  nextSeriesDefaults,
  numText,
  parseNum,
  PhotoRef,
  POSITIONS,
  RESTS,
  Rifle,
  rifleById,
  scopeById,
  ScopeUnits,
  Series,
  SeriesDefaults,
  toMrad,
  toUnits,
  unitLabel,
  unitsOf,
  ZeroEvent,
  zeroEventsAfterRemoval,
  zeroInfo,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { compact } from '../../core/data/legacy';
import { shrinkPhoto } from '../../core/image';
import { Photo } from '../../shared/photo';
import { SignedInput } from '../../shared/signed-input';

const text = (value = '') => new FormControl(value, { nonNullable: true });
const flag = (value = false) => new FormControl(value, { nonNullable: true });

/** A correction as typed on this scope; stored values have float noise after conversion. */
const shownAngle = (mrad: number | null | undefined, units: ScopeUnits): string =>
  mrad == null ? '' : numText(+toUnits(mrad, units).toFixed(4));

function seriesForm(x: Partial<Series> | SeriesDefaults, units: ScopeUnits) {
  const series = x as Partial<Series>;
  return new FormGroup({
    zeroing: flag(series.kind === 'zeroing'),
    scopeId: text(series.scopeId ?? ''),
    ammoId: text(series.ammoId ?? ''),
    device: text(series.device ?? ''),
    pos: text(series.pos ?? ''),
    rest: text(series.rest ?? ''),
    dist: text(numText(series.dist)),
    elev: text(shownAngle(series.elev, units)),
    windSpeed: text(numText(series.windSpeed)),
    windCorr: text(shownAngle(series.windCorr, units)),
    hits: text(numText(series.hits)),
    shots: text(numText(series.shots)),
    group: text(numText(series.group)),
    offUp: text(numText(series.offUp)),
    offRight: text(numText(series.offRight)),
    clicksUp: text(numText(series.clicksUp)),
    clicksRight: text(numText(series.clicksRight)),
    note: text(series.note ?? ''),
    skip: flag(!!series.skip),
    skipReason: text(series.skipReason ?? ''),
  });
}

type SeriesForm = ReturnType<typeof seriesForm>;

function zeroEventForm(event: Partial<ZeroEvent>) {
  return new FormGroup({
    afterSi: text(String(event.afterSi ?? -1)),
    dist: text(numText(event.dist)),
    ammoId: text(event.ammoId ?? ''),
    scopeId: text(event.scopeId ?? ''),
  });
}

type ZeroEventForm = ReturnType<typeof zeroEventForm>;

@Component({
  selector: 'app-session-edit-page',
  imports: [NgTemplateOutlet, Photo, ReactiveFormsModule, SignedInput],
  templateUrl: './session-edit-page.html',
  styleUrl: './session-edit-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionEditPage implements OnInit {
  protected readonly store = inject(DiaryStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly form = new FormGroup({
    date: text(),
    rifleId: text(),
    place: text(),
    temp: text(),
    pressure: text(),
    altitude: text(),
    extraRounds: text(),
    notes: text(),
    zeroEvents: new FormArray<ZeroEventForm>([]),
    coldOn: flag(),
    coldUp: text(),
    coldRight: text(),
    series: new FormArray<SeriesForm>([]),
  });

  protected readonly positions = POSITIONS;
  protected readonly rests = RESTS;
  protected readonly devName = devName;
  protected readonly photos = signal<PhotoRef[]>([]);
  protected readonly photoBusy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly cold = signal<ColdShot | null>(null);
  private readonly addedPhotos: string[] = [];

  private readonly rifleId = toSignal(
    this.form.controls.rifleId.valueChanges.pipe(map(() => this.form.controls.rifleId.value)),
    { initialValue: '' },
  );

  protected readonly session = computed(() =>
    this.store.diary().sessions.find((s) => s.id === this.id()),
  );
  protected readonly rifle = computed(() => rifleById(this.store.diary(), this.rifleId()));
  /** The cold shot block sits on its series, or on the first one for a new cold shot. */
  protected readonly coldCard = computed(() => this.cold()?.si ?? 0);
  protected readonly standalone = computed(() => !!this.cold()?.standalone);

  ngOnInit(): void {
    const session = this.session();
    if (!session) return;
    this.form.patchValue({
      date: session.date,
      rifleId: session.rifleId,
      place: session.place ?? '',
      temp: numText(session.temp),
      pressure: numText(session.pressure),
      altitude: numText(session.altitude),
      extraRounds: numText(session.extraRounds),
      notes: session.notes ?? '',
      coldOn: !!session.coldShot,
      coldUp: numText(session.coldShot?.offUp),
      coldRight: numText(session.coldShot?.offRight),
    });
    for (const series of session.series) this.pushSeries(series);
    for (const event of session.zeroEvents ?? []) {
      this.form.controls.zeroEvents.push(zeroEventForm(event));
    }
    this.photos.set((session.photos ?? []).map((photo) => ({ ...photo })));
    this.cold.set(session.coldShot ?? null);

    this.form.controls.rifleId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.relink());
  }

  protected scopeOptions(current: string): { id: string; name: string }[] {
    const diary = this.store.diary();
    const linked = mountsOf(diary, this.rifle()).map(({ scope }) => scope.id);
    return [...new Set([...linked, current])]
      .filter(Boolean)
      .map((id) => ({ id, name: scopeById(diary, id)?.name ?? '—' }));
  }

  protected unitName(scopeId: string): string {
    return unitLabel(this.unitsFor(scopeId));
  }

  /** Where a zero mark can go: before the first series or after any of them. */
  protected zeroMoments(): { value: string; label: string }[] {
    const series = this.form.controls.series.getRawValue();
    return [
      { value: '-1', label: 'до первой серии' },
      ...series.map((x, i) => ({
        value: String(i),
        label: `после серии ${i + 1}${x.dist ? ` · ${x.dist} м` : ''}`,
      })),
    ];
  }

  protected addZeroEvent(): void {
    const diary = this.store.diary();
    const rifle = this.rifle();
    const scopeId = mainScope(diary, rifle)?.id ?? '';
    const first = this.form.controls.series.at(0)?.controls.ammoId.value;
    this.form.controls.zeroEvents.push(
      zeroEventForm({
        afterSi: -1,
        dist: (rifle && zeroInfo(diary, rifle.id, scopeId)?.dist) || 100,
        ammoId: first ?? rifle?.combos[0]?.ammoId ?? '',
        scopeId,
      }),
    );
  }

  protected removeZeroEvent(index: number): void {
    this.form.controls.zeroEvents.removeAt(index);
  }

  private pushSeries(series: Partial<Series> | SeriesDefaults): void {
    const group = seriesForm(series, this.unitsFor(series.scopeId));
    this.form.controls.series.push(group);
    const { scopeId } = group.controls;
    scopeId.valueChanges
      .pipe(startWith(scopeId.value), pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([from, to]) => this.convertAngles(group, from, to));
  }

  /** Another scope has other units; the entered angle stays the same. */
  private convertAngles(group: SeriesForm, from: string, to: string): void {
    const convert = (value: string): string => {
      const parsed = parseNum(value);
      if (parsed == null) return value;
      return shownAngle(toMrad(parsed, this.unitsFor(from)), this.unitsFor(to));
    };
    const { elev, windCorr } = group.controls;
    elev.setValue(convert(elev.value));
    windCorr.setValue(convert(windCorr.value));
  }

  private unitsFor(scopeId: string | null | undefined): ScopeUnits {
    return unitsOf(scopeById(this.store.diary(), scopeId));
  }

  protected ammoOptions(current: string): { id: string; name: string }[] {
    const diary = this.store.diary();
    const linked = this.rifle()?.combos.map((c) => c.ammoId) ?? [];
    return [...new Set([...linked, current])]
      .filter(Boolean)
      .map((id) => ({ id, name: ammoName(ammoById(diary, id)) }));
  }

  protected deviceOptions(current: string): string[] {
    return [...new Set(['', ...(this.rifle()?.devices ?? []), current])];
  }

  protected addSeries(): void {
    const rifle = this.rifle();
    if (!rifle) return;
    const list = this.form.controls.series;
    const last = list.length ? this.toSeries(list.at(list.length - 1)) : null;
    const defaults = last
      ? nextSeriesDefaults(last)
      : firstSeriesDefaults(this.store.diary(), rifle as Rifle);
    this.pushSeries({ ...defaults, kind: 'normal', shots: null });
  }

  protected removeSeries(index: number): void {
    this.form.controls.series.removeAt(index);
    this.applyRemoval(index);
  }

  protected photoOptions(): { value: string; label: string }[] {
    const series = this.form.controls.series.getRawValue();
    return [
      { value: '', label: 'Вся стрельба' },
      ...series.map((x, i) => ({
        value: String(i),
        label: `Серия ${i + 1}${x.dist ? ` · ${x.dist} м` : ''}`,
      })),
    ];
  }

  /** A sheet is linked to its series target by target, on the marking screen. */
  protected sheetSeries(photo: PhotoRef): string {
    const linked = photo.marks?.targets.flatMap((t) => (t.si != null ? [t.si + 1] : [])) ?? [];
    return linked.length ? `Лист: серии ${linked.join(', ')}` : '';
  }

  protected photoValue(photo: PhotoRef): string {
    return photo.si == null ? '' : String(photo.si);
  }

  protected linkPhoto(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.photos.update((list) =>
      list.map((photo, i) => {
        if (i !== index) return photo;
        const { si: _si, ...unlinked } = photo;
        return value === '' ? unlinked : { ...unlinked, si: Number(value) };
      }),
    );
  }

  protected removePhoto(index: number): void {
    this.photos.update((list) => list.filter((_, i) => i !== index));
  }

  protected async addPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoBusy.set(true);
    try {
      const id = await this.store.addPhoto(await shrinkPhoto(file));
      this.addedPhotos.push(id);
      this.photos.update((list) => [...list, { id }]);
    } catch {
      this.error.set('Не удалось сохранить фото.');
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async cancel(): Promise<void> {
    for (const id of this.addedPhotos) await this.store.removePhoto(id);
    await this.router.navigate(['/journal', this.id()]);
  }

  protected async submit(): Promise<void> {
    const session = this.session();
    if (!session) return;
    this.dropEmptySeries();
    const v = this.form.getRawValue();
    if (!v.series.length && !session.open && !this.standalone()) {
      this.error.set('Добавьте хотя бы одну серию: дистанцию, поправку или выстрелы.');
      return;
    }
    const series = this.form.controls.series.controls.map((control) => this.toSeries(control));
    const zeroEvents = this.zeroEventsValue().filter((e) => e.dist > 0 && e.scopeId);
    const photos = this.photos();
    const kept = new Set(photos.map((photo) => photo.id));
    try {
      for (const photo of session.photos ?? []) {
        if (!kept.has(photo.id)) await this.store.removePhoto(photo.id);
      }
      await this.store.save(
        'session',
        compact({
          id: session.id,
          createdAt: session.createdAt,
          rifleId: v.rifleId,
          date: v.date,
          place: v.place.trim(),
          temp: parseNum(v.temp),
          pressure: parseNum(v.pressure),
          altitude: parseNum(v.altitude),
          extraRounds: parseNum(v.extraRounds),
          notes: v.notes.trim(),
          ...(zeroEvents.length ? { zeroEvents } : {}),
          coldShot: this.coldShot(v.coldOn, v.coldUp, v.coldRight),
          open: session.open,
          zeroing: session.zeroing,
          photos,
          series,
        }),
      );
    } catch {
      this.error.set('Не удалось сохранить запись.');
      return;
    }
    await this.router.navigate(['/journal', session.id]);
  }

  private zeroEventsValue(): ZeroEvent[] {
    return this.form.controls.zeroEvents.getRawValue().map((e) =>
      compact({
        afterSi: Number(e.afterSi),
        dist: parseNum(e.dist) ?? 0,
        ammoId: e.ammoId,
        scopeId: e.scopeId,
      }),
    );
  }

  private coldShot(on: boolean, up: string, right: string): ColdShot | null {
    if (!on) return null;
    return compact({
      ...(this.cold() ?? { si: 0 }),
      offUp: parseNum(up),
      offRight: parseNum(right),
    });
  }

  /** Series left blank are not saved. */
  private dropEmptySeries(): void {
    const list = this.form.controls.series;
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list.at(i).getRawValue();
      if (x.dist || x.elev || x.shots || x.note.trim()) continue;
      list.removeAt(i);
      this.applyRemoval(i);
    }
  }

  private applyRemoval(index: number): void {
    const result = afterSeriesRemoved(index, this.photos(), this.cold());
    this.photos.set(result.photos);
    const hadCold = this.cold() !== null;
    this.cold.set(result.coldShot);
    if (hadCold && !result.coldShot) this.form.controls.coldOn.setValue(false);
    const moved = zeroEventsAfterRemoval(this.zeroEventsValue(), index);
    this.form.controls.zeroEvents.controls.forEach((control, i) =>
      control.controls.afterSi.setValue(String(moved[i].afterSi)),
    );
  }

  /** Another rifle has other ammo and scopes, so series move to the ones it has. */
  private relink(): void {
    const rifle = this.rifle();
    const combos = rifle?.combos ?? [];
    const diary = this.store.diary();
    const mounts = mountsOf(diary, rifle).map(({ scope }) => scope.id);
    const fallback = mainScope(diary, rifle)?.id ?? '';
    for (const { controls } of [
      ...this.form.controls.series.controls,
      ...this.form.controls.zeroEvents.controls,
    ]) {
      if (!combos.some((c) => c.ammoId === controls.ammoId.value)) {
        controls.ammoId.setValue(combos[0]?.ammoId ?? '');
      }
      if (!mounts.includes(controls.scopeId.value)) controls.scopeId.setValue(fallback);
    }
  }

  private toSeries(control: SeriesForm): Series {
    const v = control.getRawValue();
    const common = {
      scopeId: v.scopeId,
      ammoId: v.ammoId,
      device: v.device,
      pos: v.pos as Series['pos'],
      rest: v.rest as Series['rest'],
      dist: parseNum(v.dist),
      shots: parseNum(v.shots),
      note: v.note.trim(),
    };
    if (v.zeroing) {
      return compact({
        kind: 'zeroing' as const,
        ...common,
        clicksUp: parseNum(v.clicksUp),
        clicksRight: parseNum(v.clicksRight),
      });
    }
    const units = this.unitsFor(v.scopeId);
    const angle = (value: string): number | null => {
      const parsed = parseNum(value);
      return parsed == null ? null : toMrad(parsed, units);
    };
    return compact({
      kind: 'normal' as const,
      ...common,
      elev: angle(v.elev),
      windSpeed: parseNum(v.windSpeed),
      windCorr: angle(v.windCorr),
      hits: parseNum(v.hits),
      group: parseNum(v.group),
      offUp: parseNum(v.offUp),
      offRight: parseNum(v.offRight),
      ...(v.skip ? { skip: true, skipReason: v.skipReason.trim() } : {}),
    });
  }
}
