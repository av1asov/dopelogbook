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
import { map } from 'rxjs';
import {
  afterSeriesRemoved,
  ammoById,
  ammoName,
  ColdShot,
  devName,
  firstSeriesDefaults,
  nextSeriesDefaults,
  numText,
  parseNum,
  PhotoRef,
  POSITIONS,
  RESTS,
  Rifle,
  rifleById,
  Series,
  SeriesDefaults,
  zeroInfo,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { compact } from '../../core/data/legacy';
import { shrinkPhoto } from '../../core/image';
import { Photo } from '../../shared/photo';
import { SignedInput } from '../../shared/signed-input';

const text = (value = '') => new FormControl(value, { nonNullable: true });
const flag = (value = false) => new FormControl(value, { nonNullable: true });

function seriesForm(x: Partial<Series> | SeriesDefaults) {
  const series = x as Partial<Series>;
  return new FormGroup({
    ammoId: text(series.ammoId ?? ''),
    device: text(series.device ?? ''),
    pos: text(series.pos ?? ''),
    rest: text(series.rest ?? ''),
    dist: text(numText(series.dist)),
    elev: text(numText(series.elev)),
    windSpeed: text(numText(series.windSpeed)),
    windCorr: text(numText(series.windCorr)),
    hits: text(numText(series.hits)),
    shots: text(numText(series.shots)),
    group: text(numText(series.group)),
    offUp: text(numText(series.offUp)),
    offRight: text(numText(series.offRight)),
    note: text(series.note ?? ''),
    skip: flag(!!series.skip),
    skipReason: text(series.skipReason ?? ''),
  });
}

type SeriesForm = ReturnType<typeof seriesForm>;

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
    rezeroOn: flag(),
    rezeroDist: text('100'),
    rezeroAmmo: text(),
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
  protected readonly units = computed(() => this.rifle()?.units ?? 'MIL');
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
      rezeroOn: !!session.rezero,
      rezeroDist: numText(
        session.rezero?.dist ?? zeroInfo(this.store.diary(), session.rifleId)?.dist ?? 100,
      ),
      rezeroAmmo: session.rezero?.ammoId ?? session.series[0]?.ammoId ?? '',
      coldOn: !!session.coldShot,
      coldUp: numText(session.coldShot?.offUp),
      coldRight: numText(session.coldShot?.offRight),
    });
    for (const series of session.series) this.form.controls.series.push(seriesForm(series));
    this.photos.set((session.photos ?? []).map((photo) => ({ ...photo })));
    this.cold.set(session.coldShot ?? null);

    this.form.controls.rifleId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.relinkAmmo());
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
    list.push(seriesForm({ ...defaults, shots: null }));
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

  protected photoValue(photo: PhotoRef): string {
    return photo.si == null ? '' : String(photo.si);
  }

  protected linkPhoto(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.photos.update((list) =>
      list.map((photo, i) => {
        if (i !== index) return photo;
        return value === '' ? { id: photo.id } : { id: photo.id, si: Number(value) };
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
    const rezeroDist = parseNum(v.rezeroDist);
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
          rezero:
            v.rezeroOn && rezeroDist && rezeroDist > 0
              ? compact({ dist: rezeroDist, ammoId: v.rezeroAmmo || series[0]?.ammoId })
              : null,
          coldShot: this.coldShot(v.coldOn, v.coldUp, v.coldRight),
          open: session.open,
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
  }

  /** Another rifle has other ammo, so series move to its first linked one. */
  private relinkAmmo(): void {
    const combos = this.rifle()?.combos ?? [];
    for (const control of this.form.controls.series.controls) {
      if (!combos.some((c) => c.ammoId === control.controls.ammoId.value)) {
        control.controls.ammoId.setValue(combos[0]?.ammoId ?? '');
      }
    }
  }

  private toSeries(control: SeriesForm): Series {
    const v = control.getRawValue();
    return compact({
      ammoId: v.ammoId,
      device: v.device,
      pos: v.pos as Series['pos'],
      rest: v.rest as Series['rest'],
      dist: parseNum(v.dist),
      elev: parseNum(v.elev),
      windSpeed: parseNum(v.windSpeed),
      windCorr: parseNum(v.windCorr),
      hits: parseNum(v.hits),
      shots: parseNum(v.shots),
      group: parseNum(v.group),
      offUp: parseNum(v.offUp),
      offRight: parseNum(v.offRight),
      note: v.note.trim(),
      ...(v.skip ? { skip: true, skipReason: v.skipReason.trim() } : {}),
    });
  }
}
