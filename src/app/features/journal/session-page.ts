import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ammoById,
  ammoChipName,
  ammoName,
  clicksText,
  elevEff,
  fmt,
  fmtAng,
  fmtTemp,
  groupAng,
  offText,
  PhotoRef,
  plural,
  rdate,
  scopeById,
  Series,
  seriesGroupAng,
  seriesStatus,
  Session,
  sessionRounds,
  sessionSetup,
  shortDate,
  toUnits,
  unitDigits,
  unitsOf,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { shrinkPhoto } from '../../core/image';
import { BottomSheet } from '../../shared/bottom-sheet';
import { Hold } from '../../shared/hold';
import { Photo } from '../../shared/photo';
import { PhotoActions } from '../../shared/photo-actions';
import {
  measuredSeries,
  numberRanges,
  offsetShort,
  photoSeries,
  showsSeries,
  withMeasurement,
  withoutPhoto,
} from '../../core/target/measure';
import { PhotoViewer } from '../../shared/photo-viewer';
import {
  MeasureApplied,
  measureContext,
  MeasureContext,
  PhotoMeasure,
} from '../photo-measure/photo-measure';
import { PhotoDeleteSheet } from './photo-delete-sheet';

const TOAST_MS = 2000;
/** Filled, outlined, dashed: enough to tell the cartridges of one day apart. */
const AMMO_STYLES = 3;

/** A photo as it was picked on the page: a sheet can be picked from any of its series. */
interface PickedPhoto {
  id: string;
  si: number | null;
  number: number | null;
}

interface Toast {
  text: string;
  /** How to bring a deleted photo back. */
  undo?: { session: Session; photoId: string };
}

const hasNumbers = (series: Series): boolean =>
  series.group != null || series.offUp != null || series.offRight != null;

/** «↑4 →3 мм»; nothing without an offset. */
function offsetMm(series: Series): string {
  if (series.offUp == null && series.offRight == null) return '';
  const text = offsetShort({ offUp: series.offUp ?? 0, offRight: series.offRight ?? 0 });
  return text === 'в точку' ? text : `${text} мм`;
}

@Component({
  selector: 'app-session-page',
  imports: [
    BottomSheet,
    Hold,
    Photo,
    PhotoActions,
    PhotoDeleteSheet,
    PhotoMeasure,
    PhotoViewer,
    RouterLink,
  ],
  templateUrl: './session-page.html',
  styleUrl: './session-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionPage {
  private readonly store = inject(DiaryStore);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);

  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly viewing = signal<PickedPhoto | null>(null);
  protected readonly menu = signal<PickedPhoto | null>(null);
  protected readonly deleting = signal<PickedPhoto | null>(null);
  protected readonly measuring = signal<{
    photo: PhotoRef;
    context: MeasureContext;
    /** A retake: marked up from scratch, and only replaces the photo on apply. */
    shot?: Blob;
  } | null>(null);
  protected readonly confirmingDelete = signal(false);
  protected readonly toast = signal<Toast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.toastTimer));
  }

  protected readonly session = computed(() =>
    this.store.diary().sessions.find((s) => s.id === this.id()),
  );

  protected readonly tiles = computed(() => {
    const s = this.session();
    if (!s) return [];
    return [
      { label: 't°', value: fmtTemp(s.temp) || '—' },
      { label: 'давл.', value: s.pressure != null ? fmt(s.pressure, 0) : '—' },
      { label: 'высота', value: s.altitude != null ? `${fmt(s.altitude, 0)} м` : '—' },
      { label: 'выстр.', value: String(sessionRounds(s)) },
    ];
  });

  protected readonly date = computed(() => rdate(this.session()?.date));

  protected readonly standaloneCold = computed(() => {
    const s = this.session();
    if (!s?.coldShot?.standalone) return '';
    return this.coldText(s, s.series[0], s.coldShot.standalone.dist ?? 0);
  });

  /** Zero marks of this session: «100 м под Igla Shakal 160 · Artelv CRS». */
  protected readonly zeroMarks = computed(() => {
    const diary = this.store.diary();
    return (this.session()?.zeroEvents ?? []).map((event) => {
      const parts = [`${event.dist} м`];
      if (event.ammoId) parts[0] += ` под ${ammoName(ammoById(diary, event.ammoId))}`;
      const scope = scopeById(diary, event.scopeId);
      if (scope) parts.push(scope.name);
      return parts.join(' · ');
    });
  });

  /** Zeroing series are summed up in one line: they only count towards barrel life. */
  protected readonly zeroing = computed(() => {
    const series = this.session()?.series.filter((x) => x.kind === 'zeroing') ?? [];
    if (!series.length) return null;
    const sum = (pick: (x: Series) => number | null | undefined) =>
      series.reduce((total, x) => total + (pick(x) ?? 0), 0);
    const clicks = clicksText(
      sum((x) => x.clicksUp),
      sum((x) => x.clicksRight),
    );
    const n = series.length;
    return {
      summary: [
        `${n} ${plural(n, 'серия', 'серии', 'серий')}`,
        `${sum((x) => x.shots)} выстр.`,
        ...(clicks ? [`${clicks} щелч.`] : []),
      ].join(' · '),
    };
  });

  /** The series on show, in the order they were shot. */
  private readonly shown = computed(() =>
    (this.session()?.series ?? [])
      .map((series, si) => ({ series, si }))
      .filter(({ series }) => series.kind === 'normal'),
  );

  /** What all the series share, and what tells each one apart. */
  protected readonly setup = computed(() => {
    const s = this.session();
    const diary = this.store.diary();
    const rifle = diary.rifles.find((r) => r.id === s?.rifleId);
    return sessionSetup(
      this.shown(),
      (id) => scopeById(diary, id)?.name ?? '',
      !!rifle?.devices?.length,
    );
  });

  protected readonly rows = computed(() => {
    const s = this.session();
    if (!s) return [];
    const diary = this.store.diary();
    const own = this.setup().own;
    // Each cartridge keeps its chip style through the record, in the order it first came.
    const styles = new Map<string, number>();
    return this.shown().map(({ series, si }, i) => {
      if (!styles.has(series.ammoId)) styles.set(series.ammoId, styles.size % AMMO_STYLES);
      return {
        si,
        number: i + 1,
        ammo: ammoChipName(ammoName(ammoById(diary, series.ammoId))),
        ammoStyle: styles.get(series.ammoId) ?? 0,
        setup: own.get(si) ?? [],
        ...this.describe(s, series, si),
      };
    });
  });

  protected readonly generalPhotos = computed(() => {
    const s = this.session();
    return (s?.photos ?? []).filter(
      (p) => !s?.series.some((x, si) => x.kind === 'normal' && showsSeries(p, si)),
    );
  });

  /** Marks need a series to go to: a session of zeroing alone has none. */
  protected readonly canMeasure = computed(
    () => this.session()?.series.some((x) => x.kind === 'normal') ?? false,
  );

  protected readonly viewed = computed(() => {
    const s = this.session();
    const picked = this.viewing();
    const photo = picked && this.photoOf(picked);
    if (!s || !picked || !photo) return null;
    const date = shortDate(s.date);
    const { holeMm } = this.contextOf(s, photo, picked.si, picked.number);
    const rows = this.rowsOf(photo);
    if (rows.length !== 1) {
      const heading = rows.length
        ? `Серии ${numberRanges(rows.map((r) => r.number))}`
        : 'Фото мишени';
      return { picked, photo, holeMm, heading, subtitle: date, group: '', offset: '' };
    }
    const [row] = rows;
    const series = s.series[row.si];
    return {
      picked,
      photo,
      holeMm,
      heading: `Серия ${row.number}${series.dist != null ? ` · ${series.dist} м` : ''}`,
      subtitle: `${date} · ${ammoName(ammoById(this.store.diary(), series.ammoId))}`,
      group: row.group,
      offset: offsetMm(series),
    };
  });

  protected readonly menuHeading = computed(() => {
    const picked = this.menu();
    const photo = picked && this.photoOf(picked);
    const numbers = photo ? this.rowsOf(photo).map((r) => r.number) : [];
    if (!numbers.length) return 'Фото мишени';
    return `Фото ${numbers.length > 1 ? 'серий' : 'серии'} ${numberRanges(numbers)}`;
  });

  protected readonly deletion = computed(() => {
    const s = this.session();
    const picked = this.deleting();
    const photo = picked && this.photoOf(picked);
    if (!s || !photo) return null;
    const numbers = this.rowsOf(photo).map((r) => r.number);
    return {
      heading: numbers.length === 1 ? `Удалить фото серии ${numbers[0]}?` : 'Удалить фото?',
      text: [
        numbers.length > 1 ? `Оно привязано к сериям ${numberRanges(numbers)}.` : '',
        photo.marks ? 'Разметка удалится вместе с фото.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      keepHint: this.keepHint(s, photo),
    };
  });

  protected view(photo: PhotoRef, si: number | null = null, number: number | null = null): void {
    this.viewing.set({ id: photo.id, si, number });
  }

  protected openMenu(
    photo: PhotoRef,
    si: number | null = null,
    number: number | null = null,
  ): void {
    this.menu.set({ id: photo.id, si, number });
  }

  protected markUp(picked: PickedPhoto): void {
    this.menu.set(null);
    const photo = this.photoOf(picked);
    if (photo) this.measure(photo, picked.si, picked.number);
  }

  /** The numbers in the series stay as they are until the new marks are applied. */
  protected async retake(picked: PickedPhoto, file: File): Promise<void> {
    this.menu.set(null);
    const s = this.session();
    const photo = this.photoOf(picked);
    if (!s || !photo) return;
    let shot: Blob;
    try {
      shot = await shrinkPhoto(file);
    } catch {
      this.showToast({ text: 'Не удалось прочитать снимок' });
      return;
    }
    if (this.canMeasure()) {
      this.measure(photo, picked.si, picked.number, shot);
      return;
    }
    await this.store.replacePhoto(photo.id, shot);
    await this.dropMarks(s, photo);
  }

  /** The numbers in the series stay; only the marks leave the photo. */
  private async dropMarks(s: Session, photo: PhotoRef): Promise<void> {
    if (!photo.marks) return;
    const { marks: _marks, ...bare } = photo;
    await this.store.save('session', {
      ...s,
      photos: (s.photos ?? []).map((p) => (p.id === photo.id ? bare : p)),
    });
  }

  /** «Сохранить фото без разметки»: the photo is already written by the marking screen. */
  protected async keepPhoto(): Promise<void> {
    const s = this.session();
    const current = this.measuring();
    this.measuring.set(null);
    if (s && current) await this.dropMarks(s, current.photo);
  }

  protected askDelete(picked: PickedPhoto): void {
    this.menu.set(null);
    this.deleting.set(picked);
  }

  protected async confirmDelete(keepNumbers: boolean): Promise<void> {
    const s = this.session();
    const picked = this.deleting();
    const photo = picked && this.photoOf(picked);
    this.deleting.set(null);
    this.viewing.set(null);
    if (!s || !photo) return;
    await this.store.detachPhoto(withoutPhoto(s, photo, keepNumbers), photo.id);
    this.showToast({ text: 'Фото удалено', undo: { session: s, photoId: photo.id } });
  }

  protected async undoDelete(): Promise<void> {
    const undo = this.toast()?.undo;
    this.hideToast();
    if (undo) await this.store.reattachPhoto(undo.session, undo.photoId);
  }

  /** `si` is null for a photo not tied to one series, or a sheet of several targets. */
  private measure(photo: PhotoRef, si: number | null, number: number | null, shot?: Blob): void {
    const s = this.session();
    if (!s) return;
    this.measuring.set({ photo, context: this.contextOf(s, photo, si, number), shot });
  }

  /** What the markup screen works with; the viewer takes the hole size from it too. */
  private contextOf(
    s: Session,
    photo: PhotoRef,
    si: number | null,
    number: number | null,
  ): MeasureContext {
    const diary = this.store.diary();
    const rifle = diary.rifles.find((r) => r.id === s.rifleId);
    const sheet = (photo.marks?.targets.length ?? 0) > 1 || photo.si == null;
    return measureContext(diary, rifle, s, {
      si: sheet ? null : si,
      number: sheet ? null : number,
    });
  }

  private photoOf(picked: PickedPhoto): PhotoRef | undefined {
    return this.session()?.photos?.find((p) => p.id === picked.id);
  }

  /** The numbered series a photo is tied to; zeroing series have no number. */
  private rowsOf(photo: PhotoRef) {
    const tied = photoSeries(photo);
    return this.rows().filter((row) => tied.includes(row.si));
  }

  /** «32 мм · ↑4 →3 мм — сняты с этого фото», or nothing when the photo gave no numbers. */
  private keepHint(session: Session, photo: PhotoRef): string {
    const measured = measuredSeries(photo).filter((si) => {
      const series = session.series[si];
      return series && hasNumbers(series);
    });
    if (!measured.length) return '';
    if (measured.length > 1) {
      const numbers = this.rows()
        .filter((row) => measured.includes(row.si))
        .map((row) => row.number);
      return `в сериях ${numberRanges(numbers)} — сняты с этого фото`;
    }
    const series = session.series[measured[0]];
    const parts = [series.group != null ? `${fmt(series.group, 0)} мм` : '', offsetMm(series)];
    return `${parts.filter(Boolean).join(' · ')} — сняты с этого фото`;
  }

  private showToast(toast: Toast): void {
    clearTimeout(this.toastTimer);
    this.toast.set(toast);
    this.toastTimer = setTimeout(() => this.toast.set(null), TOAST_MS);
  }

  private hideToast(): void {
    clearTimeout(this.toastTimer);
    this.toast.set(null);
  }

  protected async applyMeasure(result: MeasureApplied): Promise<void> {
    const s = this.session();
    const current = this.measuring();
    this.measuring.set(null);
    if (!s || !current) return;
    const { id, si } = current.photo;
    const photo = result.sheet ? { id, marks: result.marks } : { id, si, marks: result.marks };
    await this.store.save(
      'session',
      withMeasurement(s, photo, result.results, si === 0 ? result.cold : null),
    );
  }

  protected async resume(): Promise<void> {
    await this.store.reopenSession(this.id());
    await this.router.navigate(['/range']);
  }

  protected async finish(): Promise<void> {
    await this.store.closeSession(this.id());
  }

  protected async remove(): Promise<void> {
    await this.store.remove('session', this.id());
    await this.router.navigate(['/journal']);
  }

  private describe(session: Session, series: Series, si: number) {
    const scope = scopeById(this.store.diary(), series.scopeId);
    const units = unitsOf(scope);
    const digits = unitDigits(scope);
    const shown = (mrad: number | null | undefined) =>
      fmt(mrad == null ? null : toUnits(mrad, units), digits);
    const unit = this.settings.groupUnit();
    const status = seriesStatus(series);
    const effective = elevEff(series);
    const angle = groupAng(series);
    const usable = seriesGroupAng(session, si) != null;
    const cold = session.coldShot;
    return {
      dist: series.dist != null ? `${series.dist} м` : '—',
      use: status.use,
      why: status.why ?? '',
      elev: series.offUp ? `${shown(series.elev)} → ${shown(effective)}` : shown(series.elev),
      wind:
        series.windSpeed != null
          ? `${fmt(series.windSpeed, 0)} м/с · ${shown(series.windCorr)}`
          : '',
      hits: series.shots ? `${series.hits ?? 0}/${series.shots}` : '',
      group: series.group
        ? `${fmt(series.group, 0)} мм${angle != null && usable ? ` · ${fmtAng(angle, unit)}` : ''}`
        : '',
      offset: offText(series, units),
      cold:
        cold?.si === si && !cold.standalone ? this.coldText(session, series, series.dist ?? 0) : '',
      note: series.note ?? '',
      photos: (session.photos ?? []).filter((p) => showsSeries(p, si)),
    };
  }

  private coldText(session: Session, series: Series | undefined, dist: number): string {
    const units = unitsOf(scopeById(this.store.diary(), series?.scopeId));
    const cold = session.coldShot;
    if (!cold) return '';
    const offset = offText({ dist, offUp: cold.offUp, offRight: cold.offRight }, units);
    return offset || 'смещение не записано';
  }
}
