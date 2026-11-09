import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  ammoById,
  ammoName,
  Diary,
  fmt,
  fmtAng,
  numText,
  offText,
  parseNum,
  PhotoHole,
  PhotoMarks,
  PhotoScale,
  PhotoTarget,
  Point,
  Rifle,
  scopeById,
  ScopeUnits,
  Series,
  Session,
  SheetSize,
  shortDate,
  TargetTemplate,
  unitsOf,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { shrinkPhoto, turnedPhoto } from '../../core/image';
import { FlatImage, MeasureResult } from '../../core/target/detect';
import { flatUrl, readPixels, TargetDetector } from '../../core/target/detector';
import {
  applyHomography,
  homography,
  invertHomography,
  orderCorners,
  pxPerMmAt,
  rectangle,
  tiltDegrees,
} from '../../core/target/homography';
import {
  caliberMm,
  defaultSeries,
  distance,
  matchesLayout,
  measureTarget,
  assignToTargets,
  meanPoint,
  Offset,
  offsetShort,
  SeriesOption,
  SeriesResult,
  toMillimetres,
  turnPlane,
  turnPoint,
} from '../../core/target/measure';
import { issueText, Quality } from '../../core/target/quality';
import { frameCorners, sheetCorners } from '../../core/target/manual';
import { applyMarkEvent } from '../../core/target/mark-gesture';
import { UndoToast } from '../../shared/undo-toast';
import { MarkMove, Marker, Segment, TargetTap, TargetView } from '../../shared/target-view';
import { SavedTarget, TargetEditor } from '../targets/target-editor';
import { TargetPicker } from './target-picker';

export interface MeasureContext {
  title: string;
  subtitle: string;
  sheetTitle: string;
  sheetSubtitle: string;
  /** The series this photo belongs to; null when each target picks its own. */
  si: number | null;
  dist: number | null;
  shots: number | null;
  units: ScopeUnits;
  holeMm: number;
  /** Only the first series of the day can hold the cold shot. */
  allowCold: boolean;
  series: SeriesOption[];
}

export interface MeasureApplied {
  marks: PhotoMarks;
  results: SeriesResult[];
  cold: Offset | null;
  /** The series are in the marks rather than on the photo. */
  sheet: boolean;
}

/** `draft` is the series still being entered on the range; it goes after the saved ones. */
export function measureContext(
  diary: Diary,
  rifle: Rifle | undefined,
  session: Session,
  options: { si: number | null; number: number | null; draft?: Series },
): MeasureContext {
  const { si, number, draft } = options;
  const all = draft ? [...session.series, draft] : session.series;
  const main = (si != null ? all[si] : draft) ?? all.at(-1);
  const ammo = ammoById(diary, main?.ammoId);
  const caliber = ammo?.caliber || rifle?.caliber || '';
  const dist = main?.dist ?? null;
  const shots = main?.shots ?? null;
  let count = 0;
  const series = all.flatMap((x, i): SeriesOption[] => {
    if (x.kind === 'zeroing') return [];
    count++;
    const label = `серия ${count}${x.dist != null ? ` · ${x.dist} м` : ''}`;
    return [{ si: i, number: count, label, filled: x.group != null }];
  });
  return {
    title: `Серия ${number ?? ''}${dist != null ? ` · ${dist} м` : ''}`,
    subtitle: [ammoName(ammo), caliber, shots ? `${shots} выстр.` : ''].filter(Boolean).join(' · '),
    sheetTitle: `Фото листа${dist != null ? ` · ${dist} м` : ''}`,
    sheetSubtitle: `запись ${shortDate(session.date)} · ${ammoName(ammo)}`,
    si,
    dist,
    shots,
    units: unitsOf(scopeById(diary, main?.scopeId)),
    holeMm: caliberMm(caliber),
    allowCold: si === 0,
    series,
  };
}

type Mode = 'holes' | 'scale' | 'corners' | 'aim' | 'cold';

const SCALE_POINTS = 2;
type Hole = PhotoHole & { doubtful?: boolean };
type Target = Omit<PhotoTarget, 'holes'> & { holes: Hole[] };

const LAST_TARGET = 'lastTargetId';
const A4 = { w: 210, h: 297 };
const round = (value: number): number => Math.round(value * 10) / 10 || 0;

const SOURCE_TEXT: Record<PhotoScale['source'], string> = {
  sheet: 'Лист найден и выпрямлен',
  element: 'Выпрямлено по опорному элементу',
  card: 'Выпрямлено по карте',
  manual: '',
};

/** Screens 15 and 15б: finds the groups on a target photo and hands them to the series. */
@Component({
  selector: 'app-photo-measure',
  imports: [TargetEditor, TargetPicker, TargetView, UndoToast],
  templateUrl: './photo-measure.html',
  styleUrl: './photo-measure.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoMeasure implements OnInit, OnDestroy {
  private readonly store = inject(DiaryStore);
  private readonly settings = inject(SettingsStore);
  private readonly detector = inject(TargetDetector);

  readonly photoId = input.required<string>();
  readonly context = input.required<MeasureContext>();
  readonly saved = input<PhotoMarks | undefined>(undefined, { alias: 'marks' });
  /** A new shot to mark up instead of the stored one, which it replaces only on apply. */
  readonly shot = input<Blob>();

  readonly applied = output<MeasureApplied>();
  readonly closed = output<void>();

  protected readonly src = signal<string | null>(null);
  private readonly imageWidth = signal(0);
  private readonly imageHeight = signal(0);
  protected readonly loupe = signal(false);
  protected readonly mode = signal<Mode>('holes');
  protected readonly picks = signal<readonly Point[]>([]);
  /** The mark touched last, for «Удалить точку». Its id is the same as in the markers. */
  protected readonly selectedMark = signal<number | null>(null);
  private readonly undo = viewChild.required(UndoToast);
  protected readonly busy = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly mmText = signal('25');
  protected readonly sheetW = signal(String(A4.w));
  protected readonly sheetH = signal(String(A4.h));
  protected readonly pickerOpen = signal(false);
  protected readonly creating = signal<Blob | null>(null);

  protected readonly targetsList = this.store.targets;
  protected readonly targetId = signal('');
  protected readonly similar = signal<string[]>([]);
  protected readonly lastUsed = signal<string | null>(null);
  protected readonly template = computed(
    () => this.targetsList().find((t) => t.id === this.targetId()) ?? null,
  );

  private readonly scale = signal<PhotoScale | null>(null);
  private readonly matrix = signal<number[] | undefined>(undefined);
  protected readonly targets = signal<Target[]>([{ n: 1, aim: null, holes: [] }]);
  private readonly scaleLocked = signal(false);
  private readonly aimLocked = signal(false);
  private readonly scaleOrigin = signal('найдена');
  private readonly aimOrigin = signal('центр мишени');
  private readonly quality = signal<Quality | null>(null);
  private readonly pickedSeries = signal<Record<number, number>>({});

  protected readonly flat = signal<FlatImage | null>(null);
  protected readonly flatSrc = signal<string | null>(null);
  protected readonly straight = signal(true);

  private blob: Blob | undefined;
  /** The shot before turning; every turn starts from it, to re-encode only once. */
  private source: Blob | undefined;
  /** The photo in the store. It changes only together with its marks: «Отмена» undoes both. */
  private stored: Blob | undefined;
  private turns = 0;
  private saving = false;
  private generation = 0;

  protected readonly sheetMode = computed(
    () => this.targets().length > 1 || this.context().si == null,
  );

  /** The rectified picture is on show. */
  private readonly flatShown = computed(() => {
    const flat = this.flat();
    return this.straight() && this.flatSrc() && this.matrix() ? flat : null;
  });
  protected readonly canStraighten = computed(() => !!this.flatSrc() && !!this.matrix());
  protected readonly viewSrc = computed(() => (this.flatShown() ? this.flatSrc() : this.src()));
  protected readonly viewWidth = computed(() => this.flatShown()?.width ?? this.imageWidth());
  protected readonly viewHeight = computed(() => this.flatShown()?.height ?? this.imageHeight());
  /** One target is framed square, as drawn; a whole sheet keeps its shape. */
  protected readonly viewAspect = computed(() =>
    this.sheetMode() && this.viewHeight() ? this.viewWidth() / this.viewHeight() : 1,
  );
  protected readonly portrait = computed(() => this.viewAspect() < 1);

  private readonly toView = computed(() => {
    const flat = this.flatShown();
    const matrix = this.matrix();
    if (!flat || !matrix) return (p: Point): Point => p;
    return (p: Point): Point => {
      const mm = applyHomography(matrix, p);
      return { x: (mm.x - flat.x0) * flat.k, y: (mm.y - flat.y0) * flat.k };
    };
  });

  private readonly fromView = computed(() => {
    const flat = this.flatShown();
    const matrix = this.matrix();
    if (!flat || !matrix) return (p: Point): Point => p;
    const inverse = invertHomography(matrix);
    return ({ x, y }: Point): Point =>
      applyHomography(inverse, { x: x / flat.k + flat.x0, y: y / flat.k + flat.y0 });
  });

  private readonly marks = computed(() => {
    const scale = this.scale();
    return scale ? { scale, homography: this.matrix() } : null;
  });

  /** A hole of the expected size, in the pixels on show. */
  private holeRadius(at: Point): number | undefined {
    const holeMm = this.context().holeMm;
    const flat = this.flatShown();
    if (flat) return (holeMm / 2) * flat.k;
    const marks = this.marks();
    if (!marks) return undefined;
    if (marks.homography) {
      return (holeMm / 2) * pxPerMmAt(marks.homography, applyHomography(marks.homography, at));
    }
    return ((holeMm / 2) * distance(marks.scale.p1, marks.scale.p2)) / marks.scale.mm;
  }

  protected readonly results = computed(() => {
    const marks = this.marks();
    return this.targets().map((target) => ({
      target,
      result: marks ? measureTarget(marks, target) : null,
    }));
  });

  /** Targets with holes get the series in turn; a choice made by hand stays. */
  private readonly seriesByTarget = computed(() => {
    const { series } = this.context();
    const withHoles = this.targets().filter((t) => t.holes.length);
    const defaults = defaultSeries(withHoles.length, series);
    const picked = this.pickedSeries();
    return new Map(withHoles.map((t, i) => [t.n, picked[t.n] ?? defaults[i] ?? null]));
  });

  protected readonly rows = computed(() => {
    const assigned = this.seriesByTarget();
    return this.results().map(({ target, result }) => ({
      n: target.n,
      empty: !target.holes.length,
      si: assigned.get(target.n) ?? null,
      text: [
        result?.group != null ? `${fmt(result.group, 0)} мм` : '',
        result ? offsetShort(result.offset) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    }));
  });

  protected readonly applyLabel = computed(() => {
    if (!this.sheetMode()) {
      const number = this.context().series.find((o) => o.si === this.context().si)?.number;
      return `Перенести в серию ${number ?? ''}`;
    }
    const numbers = this.rows()
      .flatMap((row) => this.context().series.filter((o) => o.si === row.si))
      .map((o) => o.number)
      .sort((a, b) => a - b);
    if (numbers.length <= 1) return `Перенести в серию ${numbers[0] ?? ''}`;
    const solid = numbers.at(-1)! - numbers[0] === numbers.length - 1;
    return `Перенести в серии ${solid ? `${numbers[0]}–${numbers.at(-1)}` : numbers.join(', ')}`;
  });

  protected readonly canApply = computed(() =>
    this.sheetMode()
      ? this.rows().some((row) => row.si != null && row.text)
      : this.first().group != null || this.first().offset != null,
  );

  private readonly first = computed(
    () => this.results()[0].result ?? { group: null, offset: null, cold: null },
  );

  protected readonly steps = computed(() => {
    const scale = this.scale();
    const target = this.targets()[0];
    const found = target.holes.length;
    const shots = this.context().shots;
    const complete = found > 0 && (shots == null || found === shots);
    return [
      {
        title: '1 Мишень',
        text: scale ? `${this.scaleOrigin()}, масштаб ✓` : 'нужен масштаб',
        state: scale ? 'done' : 'active',
      },
      {
        title: '2 Точка',
        text: target.aim ? `${this.aimOrigin()} ✓` : 'не отмечена',
        state: target.aim ? 'done' : 'active',
      },
      {
        title: '3 Пробоины',
        text: shots != null ? `найдено ${found} из ${shots}` : `найдено ${found}`,
        state: complete ? 'done' : 'active',
      },
    ];
  });

  protected readonly markers = computed((): Marker[] => {
    const view = this.toView();
    const list: Marker[] = [];
    const sheet = this.sheetMode();
    const mode = this.mode();
    const selected = this.selectedMark();
    let id = 0;
    for (const target of this.targets()) {
      for (const hole of target.holes) {
        const grab = mode === 'holes' ? id++ : undefined;
        list.push({
          ...view(hole),
          r: this.holeRadius(hole),
          kind: hole.cold ? 'cold' : hole.doubtful ? 'doubt' : hole.auto ? 'found' : 'manual',
          grab,
          selected: grab != null && grab === selected,
        });
      }
      if (target.aim) {
        const aim = view(target.aim);
        list.push({ ...aim, kind: 'aim' });
        if (sheet) {
          const flat = this.flatShown();
          const gap = flat ? 37 * flat.k : 0;
          list.push({ x: aim.x - gap, y: aim.y - gap, kind: 'number', label: String(target.n) });
        }
      }
      const centre = this.scale() ? meanPoint(target.holes.filter((h) => !h.cold)) : null;
      if (centre) list.push({ ...view(centre), kind: 'centre' });
    }
    this.picks().forEach((pick, grab) => {
      list.push({
        ...view(pick),
        kind: mode === 'corners' ? 'corner' : 'point',
        grab,
        fixed: mode === 'corners',
        selected: mode === 'scale' && grab === selected,
      });
    });
    return list;
  });

  protected readonly segments = computed((): Segment[] => {
    const view = this.toView();
    const list: Segment[] = [];
    const scale = this.scale();
    const flat = this.flatShown();
    if (flat && scale?.sheet) list.push(...this.sheetEdges(flat, scale.sheet));
    const [p1, p2] = this.picks();
    if (this.mode() === 'scale' && p1 && p2) list.push({ a: view(p1), b: view(p2), kind: 'scale' });
    if (this.sheetMode()) return list;
    if (scale && scale.source !== 'sheet' && this.mode() !== 'scale') {
      list.push({
        a: view(scale.p1),
        b: view(scale.p2),
        kind: 'scale',
        label: `${fmt(scale.mm, 0)} мм`,
      });
    }
    const [target] = this.targets();
    const holes = target.holes.filter((h) => !h.cold);
    let widest = 0;
    let pair: [Point, Point] | null = null;
    holes.forEach((a, i) => {
      for (const b of holes.slice(i + 1)) {
        const gap = distance(a, b);
        if (gap > widest) [widest, pair] = [gap, [a, b]];
      }
    });
    if (pair) list.push({ a: view(pair[0]), b: view(pair[1]), kind: 'spread' });
    const centre = scale ? meanPoint(holes) : null;
    if (target.aim && centre) list.push({ a: view(target.aim), b: view(centre), kind: 'offset' });
    return list;
  });

  /** Green brackets at the corners of the sheet, as on the mockup. */
  private sheetEdges(flat: FlatImage, sheet: { w: number; h: number }): Segment[] {
    const at = (x: number, y: number): Point => ({
      x: (x - flat.x0) * flat.k,
      y: (y - flat.y0) * flat.k,
    });
    const arm = 14;
    return [
      [0, 0, 1, 1],
      [sheet.w, 0, -1, 1],
      [0, sheet.h, 1, -1],
      [sheet.w, sheet.h, -1, -1],
    ].flatMap(([x, y, dx, dy]): Segment[] => [
      { a: at(x, y), b: at(x + dx * arm, y), kind: 'edge' },
      { a: at(x, y), b: at(x, y + dy * arm), kind: 'edge' },
    ]);
  }

  protected readonly groupText = computed(() => {
    const group = this.first().group;
    return group == null ? '—' : `${fmt(group, 0)} мм`;
  });

  protected readonly groupAngle = computed(() => {
    const group = this.first().group;
    const dist = this.context().dist;
    if (group == null) return 'нужно 2 пробоины';
    if (!dist) return 'по центрам';
    return `${fmtAng(group / dist, this.settings.groupUnit())} · по центрам`;
  });

  protected readonly offsetText = computed(() => {
    const offset = this.first().offset;
    if (!offset) return '—';
    const up = `${offset.offUp >= 0 ? '↑' : '↓'} ${fmt(Math.abs(offset.offUp), 0)}`;
    const right = `${offset.offRight >= 0 ? '→' : '←'} ${fmt(Math.abs(offset.offRight), 0)}`;
    return `${up} ${right} мм`;
  });

  protected readonly offsetAngle = computed(() => {
    const offset = this.first().offset;
    const { dist, units } = this.context();
    if (!offset) return 'нужна точка прицеливания';
    return offText({ ...offset, dist }, units) || 'нет дистанции';
  });

  protected readonly prompt = computed(() => {
    switch (this.mode()) {
      case 'scale':
        return this.picks().length < 2
          ? 'Поставьте две точки на концах отрезка известной длины'
          : 'Тяните точки, чтобы поправить';
      case 'corners':
        return 'Перетащите четыре маркера на углы листа';
      case 'aim':
        return 'Коснитесь точки прицеливания';
      case 'cold':
        return 'Коснитесь пробоины холодного выстрела';
      default:
        return this.busy() ?? this.notice() ?? this.countHint();
    }
  });

  private countHint(): string | null {
    if (this.sheetMode() || !this.scale()) return null;
    const { shots } = this.context();
    const found = this.targets()[0].holes.length;
    if (shots == null || found === shots) return null;
    return found < shots
      ? `Найдено ${found} из ${shots}, отметьте недостающие`
      : `Найдено ${found} из ${shots}, уберите лишние`;
  }

  private readonly tilt = computed(() => {
    const matrix = this.matrix();
    if (!matrix || !this.imageWidth()) return null;
    return Math.round(tiltDegrees(matrix, this.imageWidth(), this.imageHeight()));
  });

  protected readonly issue = computed(() => {
    const quality = this.quality();
    const [first] = quality?.issues ?? [];
    return first ? issueText(first, quality?.printScale) : null;
  });

  /** «Лист найден и выпрямлен · наклон 18° · лист ровный ✓» */
  protected readonly status = computed(() => {
    const scale = this.scale();
    const tilt = this.tilt();
    if (!scale || tilt == null) return null;
    const flat = this.quality() && !this.quality()?.issues.includes('bent');
    return [SOURCE_TEXT[scale.source], `наклон ${tilt}°`, flat ? 'лист ровный ✓' : '']
      .filter(Boolean)
      .join(' · ');
  });

  protected readonly badge = computed(() => {
    const tilt = this.tilt();
    return tilt == null ? null : `выпрямлено · наклон ${tilt}°`;
  });

  async ngOnInit(): Promise<void> {
    this.stored = await this.store.getPhoto(this.photoId());
    this.blob = this.source = this.shot() ?? this.stored;
    if (!this.blob) {
      this.notice.set('Фото не найдено');
      return;
    }
    await this.loadPhoto();
    const last = (await this.settings.readSetting<string>(LAST_TARGET)) ?? null;
    this.lastUsed.set(last);
    const saved = this.saved();
    if (saved) {
      this.restore(saved);
      return;
    }
    const known = this.targetsList().some((t) => t.id === last);
    this.targetId.set(known ? (last as string) : (this.targetsList()[0]?.id ?? ''));
    await this.detect(this.template(), true);
  }

  ngOnDestroy(): void {
    this.generation++;
    for (const url of [this.src(), this.flatSrc()]) if (url) URL.revokeObjectURL(url);
  }

  private async loadPhoto(): Promise<void> {
    const blob = this.blob as Blob;
    const bitmap = await createImageBitmap(blob);
    this.imageWidth.set(bitmap.width);
    this.imageHeight.set(bitmap.height);
    bitmap.close();
    const old = this.src();
    if (old) URL.revokeObjectURL(old);
    this.src.set(URL.createObjectURL(blob));
  }

  private restore(saved: PhotoMarks): void {
    this.targetId.set(saved.templateId ?? '');
    this.scale.set(saved.scale);
    this.matrix.set(saved.homography);
    this.targets.set(saved.targets);
    this.scaleLocked.set(true);
    this.aimLocked.set(true);
    this.scaleOrigin.set('сохранена');
    this.aimOrigin.set('сохранена');
    const picked: Record<number, number> = {};
    const known = new Set(this.context().series.map((option) => option.si));
    for (const target of saved.targets) {
      // A series that was never saved has no place in the record.
      if (target.si != null && known.has(target.si)) picked[target.n] = target.si;
    }
    this.pickedSeries.set(picked);
    if (saved.homography) void this.straighten(saved);
  }

  /** Reopened marks only need the picture rectified again. */
  private async straighten({ homography: matrix, scale }: PhotoMarks): Promise<void> {
    const generation = ++this.generation;
    try {
      const flat = await this.rectified(this.blob as Blob, matrix as number[], scale.sheet);
      if (generation === this.generation) await this.showFlat(flat);
    } catch {
      this.straight.set(false);
    }
  }

  private async rectified(blob: Blob, matrix: number[], sheet?: SheetSize): Promise<FlatImage> {
    const image = await readPixels(blob);
    const { flat } = await this.detector.warp({ kind: 'warp', image, homography: matrix, sheet });
    return flat;
  }

  /** Quarter turns clockwise, marks included. */
  protected async turnPhoto(quarters = 1): Promise<void> {
    if (!this.source || this.busy() || this.saving) return;
    const generation = ++this.generation;
    this.busy.set('Поворачиваю снимок…');
    try {
      const turns = (this.turns + quarters) % 4;
      const blob = turns ? await turnedPhoto(this.source, turns) : this.source;
      const photo = { w: this.imageWidth(), h: this.imageHeight() };
      const marks = this.marks();
      const plane = marks && turnPlane(marks, photo, quarters);
      const flat = plane?.homography
        ? await this.rectified(blob, plane.homography, plane.scale.sheet)
        : null;
      if (generation !== this.generation) return;
      this.blob = blob;
      this.turns = turns;
      await this.loadPhoto();
      await this.showFlat(flat);
      const turn = (p: Point): Point => turnPoint(photo, quarters, p);
      if (plane) {
        this.scale.set(plane.scale);
        this.matrix.set(plane.homography);
      }
      this.picks.update((picks) => picks.map(turn));
      this.targets.update((targets) =>
        targets.map((t) => ({
          ...t,
          aim: t.aim && turn(t.aim),
          holes: t.holes.map((hole) => ({ ...hole, ...turn(hole) })),
        })),
      );
    } catch {
      if (generation === this.generation) this.notice.set('Не удалось повернуть снимок');
    } finally {
      if (generation === this.generation) this.busy.set(null);
    }
  }

  private async showFlat(flat: FlatImage | null): Promise<void> {
    const old = this.flatSrc();
    if (old) URL.revokeObjectURL(old);
    this.flatSrc.set(flat ? await flatUrl(flat) : null);
    this.flat.set(flat && { ...flat, data: new Uint8ClampedArray() });
  }

  protected chooseTarget(id: string): void {
    this.pickerOpen.set(false);
    if (id === this.targetId() && this.scale()) return;
    void this.applyTemplate(id);
  }

  private async applyTemplate(id: string): Promise<void> {
    this.targetId.set(id);
    if (id) {
      this.lastUsed.set(id);
      void this.settings.writeSetting(LAST_TARGET, id);
    }
    this.resetPlane();
    await this.detect(this.template(), false);
  }

  private resetPlane(): void {
    this.scale.set(null);
    this.matrix.set(undefined);
    this.quality.set(null);
    this.scaleLocked.set(false);
    this.aimLocked.set(false);
    this.scaleOrigin.set('найдена');
    this.aimOrigin.set('центр мишени');
    this.pickedSeries.set({});
    this.straight.set(true);
    void this.showFlat(null);
    const manual = this.targets().flatMap((t) => t.holes.filter((h) => !h.auto));
    this.targets.set([{ n: 1, aim: null, holes: manual }]);
    this.notice.set(null);
  }

  protected newTemplate(): void {
    this.pickerOpen.set(false);
    this.creating.set(this.blob ?? null);
  }

  /** The photo follows the turn made in the editor, or the numbers would not match it. */
  protected async templateSaved({ template, turns }: SavedTarget): Promise<void> {
    this.creating.set(null);
    if (turns) await this.turnPhoto(turns);
    await this.applyTemplate(template.id);
  }

  protected async retake(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.blob = this.source = await shrinkPhoto(file);
    this.turns = 0;
    await this.loadPhoto();
    this.targets.set([{ n: 1, aim: null, holes: [] }]);
    this.resetPlane();
    await this.detect(this.template(), false);
  }

  protected startMode(mode: Mode): void {
    this.mode.set(this.mode() === mode ? 'holes' : mode);
    this.picks.set([]);
    this.selectedMark.set(null);
    if (this.mode() === 'scale') this.straight.set(false);
    if (this.mode() === 'scale' && this.scale()?.source === 'manual') {
      const scale = this.scale() as PhotoScale;
      this.picks.set([scale.p1, scale.p2]);
      this.mmText.set(numText(scale.mm));
    }
    if (this.mode() === 'corners') {
      this.straight.set(false);
      const sheet = this.template()?.sheet ?? A4;
      this.sheetW.set(String(sheet.w));
      this.sheetH.set(String(sheet.h));
      this.picks.set(this.startingCorners());
    }
  }

  /** The sheet found on the photo, or just inside the edges of the shot. */
  private startingCorners(): Point[] {
    const scale = this.scale();
    const matrix = this.matrix();
    if (matrix && scale?.sheet) return sheetCorners(matrix, scale.sheet);
    return frameCorners({ w: this.imageWidth(), h: this.imageHeight() });
  }

  /** There is no room for another point of the segment; corners only ever move. */
  protected readonly marksFull = computed(() => {
    const mode = this.mode();
    return mode === 'corners' || (mode === 'scale' && this.picks().length >= SCALE_POINTS);
  });

  protected added(tap: TargetTap): void {
    const at = this.fromView()(tap.at);
    this.selectedMark.set(null);
    switch (this.mode()) {
      case 'holes':
        this.updateHoles(this.nearestTarget(at), (holes) => [...holes, { ...at, auto: false }]);
        break;
      case 'aim':
        this.setAim(at);
        break;
      case 'cold':
        this.markCold(tap);
        break;
      case 'scale':
        this.picks.update((picks) =>
          applyMarkEvent(picks, { type: 'add', at, reach: tap.reach }, SCALE_POINTS),
        );
        break;
    }
  }

  protected moved({ id, at }: MarkMove): void {
    const point = this.fromView()(at);
    if (this.mode() !== 'holes') {
      this.picks.update((picks) => applyMarkEvent(picks, { type: 'move', id, at: point }, 4));
      return;
    }
    const found = this.holeById(id);
    if (!found) return;
    this.updateHoles(found.target, (holes) =>
      holes.map((hole, i) => (i === found.hole ? { ...hole, ...point, auto: false } : hole)),
    );
  }

  protected removeMark(id: number): void {
    this.selectedMark.set(null);
    if (this.mode() === 'holes') {
      const found = this.holeById(id);
      if (!found) return;
      const { target, hole } = found;
      const removed = this.targets()[target].holes[hole];
      this.updateHoles(target, (holes) => holes.filter((_, i) => i !== hole));
      this.undo().show('Убрано', () =>
        this.updateHoles(target, (holes) => [
          ...holes.slice(0, hole),
          removed,
          ...holes.slice(hole),
        ]),
      );
    } else if (this.mode() === 'scale') {
      const removed = this.picks()[id];
      this.picks.update((list) => applyMarkEvent(list, { type: 'remove', id }, SCALE_POINTS));
      this.undo().show('Убрано', () => {
        if (this.mode() !== 'scale' || this.picks().length >= SCALE_POINTS) return;
        this.picks.update((list) => [...list.slice(0, id), removed, ...list.slice(id)]);
      });
    }
  }

  protected resetSegment(): void {
    this.picks.set([]);
    this.selectedMark.set(null);
  }

  /** The id of a hole counts the holes of all the targets in a row. */
  private holeById(id: number): { target: number; hole: number } | null {
    let rest = id;
    const targets = this.targets();
    for (let target = 0; target < targets.length; target++) {
      if (rest < targets[target].holes.length) return { target, hole: rest };
      rest -= targets[target].holes.length;
    }
    return null;
  }

  private updateHoles(index: number, change: (holes: Hole[]) => Hole[]): void {
    this.targets.update((targets) =>
      targets.map((t, i) => (i === index ? { ...t, holes: change(t.holes) } : t)),
    );
  }

  private setAim(at: Point): void {
    const index = this.nearestTarget(at);
    if (this.quality()?.issues.includes('elements')) this.moveLayout(index, at);
    else {
      this.targets.update((targets) =>
        targets.map((t, i) => (i === index ? { ...t, aim: at } : t)),
      );
    }
    this.aimLocked.set(true);
    this.aimOrigin.set('вручную');
    this.mode.set('holes');
  }

  /** With no elements found, one centre set by hand places the whole sheet of targets. */
  private moveLayout(index: number, at: Point): void {
    const matrix = this.matrix();
    const targets = this.targets();
    const old = targets[index].aim;
    if (!matrix || !old || targets.some((t) => !t.aim)) {
      this.targets.set(targets.map((t, i) => (i === index ? { ...t, aim: at } : t)));
      return;
    }
    const inverse = invertHomography(matrix);
    const [from, to] = [applyHomography(matrix, old), applyHomography(matrix, at)];
    const [dx, dy] = [to.x - from.x, to.y - from.y];
    const places = targets.map((t) => {
      const mm = applyHomography(matrix, t.aim as Point);
      return { x: mm.x + dx, y: mm.y + dy };
    });
    const holes = targets.flatMap((t) => t.holes);
    const owners = assignToTargets(
      holes.map((hole) => applyHomography(matrix, hole)),
      places,
    );
    this.targets.set(
      targets.map((t, i) => ({
        ...t,
        aim: applyHomography(inverse, places[i]),
        holes: holes.filter((_, h) => owners[h] === i || (owners[h] < 0 && i === index)),
      })),
    );
    this.quality.update(
      (quality) =>
        quality && { ...quality, issues: quality.issues.filter((q) => q !== 'elements') },
    );
  }

  protected readonly canTurnNumbers = computed(
    () => this.sheetMode() && this.targets().length > 1 && this.targets().every((t) => t.aim),
  );

  /** The sheet may lie so that nothing on it tells its numbers: a person can see them. */
  protected turnNumbers(): void {
    const targets = this.targets();
    const places = targets.map((t) => t.aim as Point);
    const centre = meanPoint(places) as Point;
    const reach = (Math.min(...places.map((p) => distance(p, centre))) || 1) / 2;
    for (const quarter of [1, 2, 3]) {
      const moved = places.map((place) => {
        let [x, y] = [place.x - centre.x, place.y - centre.y];
        for (let i = 0; i < quarter; i++) [x, y] = [-y, x];
        return places.findIndex((p) => distance(p, { x: x + centre.x, y: y + centre.y }) < reach);
      });
      if (moved.includes(-1) || new Set(moved).size < moved.length) continue;
      this.targets.set(
        targets.map((t, i) => ({ ...targets[moved[i]], n: t.n })).sort((a, b) => a.n - b.n),
      );
      this.pickedSeries.set({});
      return;
    }
  }

  /** The target a mark on the photo belongs to: the one with the closest point of aim. */
  private nearestTarget(at: Point): number {
    let index = 0;
    let closest = Infinity;
    this.targets().forEach((target, i) => {
      if (!target.aim) return;
      const gap = distance(target.aim, at);
      if (gap < closest) [closest, index] = [gap, i];
    });
    return index;
  }

  private markCold({ at, reach }: TargetTap): void {
    const nearest = this.nearestHole(at, reach);
    if (!nearest) return;
    this.updateHoles(nearest.target, (holes) =>
      holes.map(({ cold, ...hole }, i) =>
        i === nearest.hole && !cold ? { ...hole, cold: true } : hole,
      ),
    );
    this.mode.set('holes');
  }

  /** `at` and `reach` are in the pixels on show. */
  private nearestHole(at: Point, reach: number): { target: number; hole: number } | null {
    const view = this.toView();
    let found: { target: number; hole: number } | null = null;
    let closest = Infinity;
    this.targets().forEach((target, t) => {
      target.holes.forEach((hole, h) => {
        const seen = view(hole);
        const gap = distance(seen, at);
        const limit = Math.max(reach, (this.holeRadius(hole) ?? 0) * 1.5);
        if (gap <= limit && gap < closest) [closest, found] = [gap, { target: t, hole: h }];
      });
    });
    return found;
  }

  protected applyScale(): void {
    const [p1, p2] = this.picks();
    const mm = parseNum(this.mmText());
    if (!p1 || !p2 || !mm || mm <= 0) return;
    this.setManualPlane({ source: 'manual', p1, p2, mm }, undefined);
  }

  protected applyCorners(): void {
    const picks = [...this.picks()];
    let w = parseNum(this.sheetW());
    let h = parseNum(this.sheetH());
    if (picks.length !== 4 || !w || !h || w <= 0 || h <= 0) return;
    const points = orderCorners(picks);
    // The sheet may lie either way round; the longer side on the photo is the longer one.
    if (distance(points[0], points[1]) > distance(points[0], points[3]) !== w > h) [w, h] = [h, w];
    const matrix = homography(points, rectangle(w, h));
    if (!matrix) return;
    this.setManualPlane({ source: 'sheet', p1: points[0], p2: points[1], mm: w, sheet: { w, h } }, [
      ...matrix,
    ]);
  }

  private setManualPlane(scale: PhotoScale, matrix: number[] | undefined): void {
    this.scale.set(scale);
    this.matrix.set(matrix);
    this.scaleLocked.set(true);
    this.scaleOrigin.set('вручную');
    this.picks.set([]);
    this.selectedMark.set(null);
    this.mode.set('holes');
    this.straight.set(!!matrix);
    void this.showFlat(null);
    void this.detect(scale.source === 'sheet' ? this.template() : null, false);
  }

  protected setSeries(n: number, event: Event): void {
    const si = Number((event.target as HTMLSelectElement).value);
    this.pickedSeries.update((picked) => ({ ...picked, [n]: si }));
  }

  protected async submit(): Promise<void> {
    const marks = this.marks();
    if (!marks || !this.canApply() || this.saving) return;
    const sheet = this.sheetMode();
    const assigned = this.seriesByTarget();
    const clean = this.targets().map(({ holes, ...target }): PhotoTarget => {
      const si = sheet ? assigned.get(target.n) : null;
      const { si: _old, ...rest } = target;
      return {
        ...rest,
        ...(si != null ? { si } : {}),
        holes: holes.map(({ doubtful: _doubtful, ...hole }) => hole),
      };
    });
    const results = clean.flatMap((target): SeriesResult[] => {
      const si = sheet ? target.si : this.context().si;
      if (si == null) return [];
      const { group, offset } = measureTarget(marks, target);
      return [
        {
          si,
          group: group == null ? null : round(group),
          offset: offset && { offUp: round(offset.offUp), offRight: round(offset.offRight) },
        },
      ];
    });
    const cold = sheet ? null : measureTarget(marks, clean[0]).cold;
    const templateId = this.targetId();
    if (this.blob !== this.stored) {
      this.saving = true;
      try {
        await this.store.replacePhoto(this.photoId(), this.blob as Blob);
        this.stored = this.source = this.blob;
        this.turns = 0;
      } catch {
        this.notice.set('Не удалось сохранить снимок');
        return;
      } finally {
        this.saving = false;
      }
    }
    this.applied.emit({
      marks: {
        ...(templateId ? { templateId } : {}),
        scale: marks.scale,
        ...(marks.homography ? { homography: marks.homography } : {}),
        targets: clean,
      },
      results,
      cold: cold && { offUp: round(cold.offUp), offRight: round(cold.offRight) },
      sheet,
    });
  }

  /** With no template only the holes are searched for, on the plane already set. */
  private async detect(template: TargetTemplate | null, mayGuess: boolean): Promise<void> {
    const marks = this.scaleLocked() ? this.marks() : null;
    if (!this.blob || (!template && !marks && this.targetId())) return;
    const generation = ++this.generation;
    const { holeMm, shots } = this.context();
    this.busy.set('Ищу мишень и пробоины…');
    this.notice.set(null);
    try {
      const image = await readPixels(this.blob);
      const result = await this.detector.measure({
        kind: 'measure',
        image,
        template: template && {
          sheet: template.sheet,
          targets: template.targets,
          artSize: template.artSize,
        },
        manual: marks,
        holeMm,
        shots,
      });
      if (generation !== this.generation) return;
      const similar = this.targetsList()
        .filter((t) => matchesLayout(t, result.elements))
        .map((t) => t.id);
      this.similar.set(similar);
      if (mayGuess && similar.length && !similar.includes(this.targetId())) {
        this.targetId.set(similar[0]);
        this.busy.set(null);
        await this.detect(this.template(), false);
        return;
      }
      await this.adopt(result, template);
    } catch {
      if (generation === this.generation) {
        this.notice.set('Автопоиск недоступен — отметьте вручную');
      }
    } finally {
      if (generation === this.generation) this.busy.set(null);
    }
  }

  private async adopt(result: MeasureResult, template: TargetTemplate | null): Promise<void> {
    const { plane, flat, quality } = result;
    if (plane && !this.scaleLocked()) {
      this.scale.set(plane.scale);
      this.matrix.set(plane.homography);
    }
    if (plane) {
      this.quality.set(quality);
      await this.showFlat(flat);
    } else if (template || this.targetId()) {
      this.notice.set('Мишень не распознана — задайте масштаб вручную');
    } else {
      this.notice.set('Отметьте масштаб и точку прицеливания');
    }
    if (!result.targets) return;
    const previous = this.targets();
    this.targets.set(
      result.targets.map((found, i) => {
        const old = previous.find((t) => t.n === found.n) ?? previous[i];
        const keepAim = this.aimLocked() && old?.aim;
        return {
          n: found.n,
          aim: keepAim ? old.aim : (found.aim ?? old?.aim ?? null),
          holes: [
            ...(old?.holes.filter((h) => !h.auto) ?? []),
            ...found.holes.map(({ x, y, doubtful }) => ({ x, y, auto: true, doubtful })),
          ],
        };
      }),
    );
  }
}
