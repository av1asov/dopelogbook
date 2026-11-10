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
import { fmt, numText, parseNum, Point, SheetSize } from '../../core/ballistics';
import { FlatImage, FoundPlane } from '../../core/target/detect';
import { flatUrl, readPixels, TargetDetector } from '../../core/target/detector';
import { applyHomography, invertHomography, orderCorners } from '../../core/target/homography';
import {
  canMeasure,
  frameCorners,
  ManualElement,
  ManualLayout,
  manualLayout,
  ManualMarks,
  MIN_SEGMENT_MM,
  segmentReading,
  sheetCheck,
  sheetCorners,
  sheetPlane,
} from '../../core/target/manual';
import { applyMarkEvent } from '../../core/target/mark-gesture';
import { Marker, MarkMove, Segment, TargetTap, TargetView } from '../../shared/target-view';
import { UndoToast } from '../../shared/undo-toast';

type Step = 'corners' | 'scale' | 'targets';

const SEGMENT_POINTS = 2;
const CORNER_POINTS = 4;
const MAX_TARGETS = 12;
const EDGE_ID = 1000;
const AIM_ID = 1001;
/** Share of the shorter side of the shot, when no size or scale tells the element's radius. */
const DEFAULT_RADIUS = 0.08;

export interface ManualDone {
  marks: ManualMarks;
  /** The sheet as set by hand; null when its corners were left alone. */
  plane: { matrix: number[]; sheet: SheetSize } | null;
  /** The rectified picture, when the corners were moved here. */
  flat: FlatImage | null;
  layout: ManualLayout;
  /** The scale was given as a segment of known length. */
  scaled: boolean;
}

/** Screen 16b: corners, scale and targets marked by hand, each of them optional. */
@Component({
  selector: 'app-target-manual',
  imports: [TargetView, UndoToast],
  templateUrl: './target-manual.html',
  styleUrl: './target-manual.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetManual implements OnInit, OnDestroy {
  private readonly detector = inject(TargetDetector);

  readonly photo = input.required<Blob>();
  readonly photoSrc = input.required<string>();
  readonly imageSize = input.required<SheetSize>();
  readonly sheet = input.required<SheetSize>();
  /** What the autosearch found, to start from. */
  readonly plane = input<FoundPlane | null>(null);
  readonly flat = input<FlatImage | null>(null);
  readonly flatSrc = input<string | null>(null);
  readonly count = input(1);
  /** Side or diameter of the element as the template has it now, mm. */
  readonly elementMm = input<number | null>(null);
  readonly element = input<ManualElement>('circle');
  /** The marks made here the last time, to go on from. */
  readonly saved = input<ManualMarks | null>(null, { alias: 'marks' });

  readonly done = output<ManualDone>();
  readonly closed = output<void>();

  private readonly undo = viewChild.required(UndoToast);

  protected readonly step = signal<Step>('corners');
  protected readonly corners = signal<readonly Point[]>([]);
  private readonly cornersSet = signal(false);
  protected readonly segment = signal<readonly Point[]>([]);
  protected readonly mmText = signal('');
  protected readonly centres = signal<readonly (Point | null)[]>([null]);
  protected readonly aim = signal<Point | null>(null);
  private readonly edge = signal<Point | null>(null);
  protected readonly kind = signal<ManualElement>('circle');
  private readonly sized = signal(false);
  protected readonly placingAim = signal(false);
  protected readonly selectedMark = signal<number | null>(null);
  protected readonly hint = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  private readonly picture = signal<{ flat: FlatImage; src: string } | null>(null);
  /** The picture made here, with its pixels; the one passed in has none. */
  private warped: FlatImage | null = null;
  private ownUrl: string | null = null;
  private stale = false;
  private generation = 0;

  private readonly cornersPlane = computed(() =>
    this.cornersSet() ? sheetPlane(this.corners(), this.sheet()) : null,
  );
  private readonly matrix = computed(
    () => this.cornersPlane()?.matrix ?? this.plane()?.homography ?? null,
  );
  private readonly onSheet = computed(() => !!this.cornersPlane() || !!this.plane()?.scale.sheet);
  private readonly activeSheet = computed(
    () => this.cornersPlane()?.sheet ?? this.plane()?.scale.sheet ?? this.sheet(),
  );

  private readonly flatShown = computed(() =>
    this.step() !== 'corners' && this.matrix() ? (this.picture()?.flat ?? null) : null,
  );
  protected readonly viewSrc = computed(() =>
    this.flatShown() ? (this.picture()?.src ?? this.photoSrc()) : this.photoSrc(),
  );
  protected readonly viewWidth = computed(() => this.flatShown()?.width ?? this.imageSize().w);
  protected readonly viewHeight = computed(() => this.flatShown()?.height ?? this.imageSize().h);

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

  private readonly mm = computed(() => {
    const value = parseNum(this.mmText());
    return value != null && value > 0 ? value : null;
  });

  private readonly current = computed((): ManualMarks => ({
    corners: this.cornersSet() ? this.corners() : null,
    segment: this.segment(),
    mm: this.mm(),
    centres: this.centres(),
    aim: this.aim(),
    edge: this.edge(),
    element: this.kind(),
    sized: this.sized(),
  }));

  protected readonly tabs = computed(() => [
    { step: 'corners' as const, label: '1 Углы листа', done: this.cornersSet() },
    { step: 'scale' as const, label: '2 Масштаб', done: !!this.reading() },
    { step: 'targets' as const, label: '3 Мишени', done: this.marked() > 0 },
  ]);

  private readonly marked = computed(() => this.centres().filter(Boolean).length);

  private readonly reading = computed(() => segmentReading(this.segment(), this.mm()));
  protected readonly readingText = computed(() => {
    const reading = this.reading();
    return reading
      ? { scale: `${fmt(reading.pxPerMm, 1)} px/мм`, error: `±${fmt(reading.errorMm, 1)} мм` }
      : null;
  });

  protected readonly noCorners = computed(() => !this.matrix());

  protected readonly tooShort = computed(() => {
    const mm = this.mm();
    return !!this.reading() && mm != null && mm < MIN_SEGMENT_MM;
  });

  protected readonly check = computed(() => {
    if (!this.onSheet()) return null;
    const sheet = this.activeSheet();
    const check = sheetCheck(this.current(), this.matrix(), sheet);
    return check && { off: check.off, text: `${numText(sheet.w)} мм: ${fmt(check.width, 1)} мм` };
  });

  protected readonly full = computed(() => {
    switch (this.step()) {
      case 'corners':
        return true;
      case 'scale':
        return this.segment().length >= SEGMENT_POINTS;
      case 'targets':
        return !this.placingAim() && this.centres().every(Boolean);
    }
  });

  protected readonly canRemoveSelected = computed(() => {
    const id = this.selectedMark();
    return id != null && id !== EDGE_ID && this.step() !== 'corners';
  });

  protected readonly prompt = computed(() => {
    if (this.hint()) return this.hint();
    switch (this.step()) {
      case 'corners':
        return 'Перетащите маркеры на углы листа';
      case 'scale':
        return this.segment().length < SEGMENT_POINTS
          ? 'Поставьте две точки'
          : 'Тяните точки, чтобы поправить';
      case 'targets': {
        if (this.placingAim()) return 'Наведите лупу на точку прицеливания и отпустите';
        const next = this.centres().indexOf(null);
        return next < 0 ? 'Все мишени отмечены' : `Коснитесь центра мишени ${next + 1}`;
      }
    }
  });

  protected readonly sizeText = computed(() => {
    if (!this.edge()) return null;
    const { element } = manualLayout(
      { ...this.current(), sized: true },
      this.matrix(),
      this.onSheet(),
      this.activeSheet(),
    );
    if (!element) return 'нужен масштаб';
    const size = numText(element.size);
    return element.kind === 'circle' ? `⌀ ${size} мм` : `сторона ${size} мм`;
  });

  private readonly radius = computed(() => {
    const [first] = this.centres();
    const edge = this.edge();
    if (!first || !edge) return 0;
    const view = this.toView();
    const [a, b] = [view(first), view(edge)];
    return Math.hypot(a.x - b.x, a.y - b.y);
  });

  protected readonly markers = computed((): Marker[] => {
    const view = this.toView();
    const selected = this.selectedMark();
    const step = this.step();
    if (step === 'corners') {
      return this.corners().map((p, grab) => ({ ...p, kind: 'corner', grab, fixed: true }));
    }
    const list: Marker[] = [];
    if (this.cornersSet()) {
      for (const p of this.corners()) list.push({ ...view(p), kind: 'corner' });
    }
    if (step === 'scale') {
      this.segment().forEach((p, grab) => {
        list.push({ ...view(p), kind: 'handle', grab, selected: grab === selected });
      });
      return list;
    }
    const r = this.radius();
    this.centres().forEach((p, grab) => {
      if (!p) return;
      const at = view(p);
      if (r) list.push({ ...at, r, kind: this.kind() === 'circle' ? 'ring' : 'frame' });
      list.push({ ...at, kind: 'point', grab, selected: grab === selected });
      const gap = Math.max(r, 18);
      list.push({ x: at.x - gap, y: at.y - gap, kind: 'number', label: String(grab + 1) });
    });
    const edge = this.edge();
    if (edge) list.push({ ...view(edge), kind: 'handle', grab: EDGE_ID, fixed: true });
    const aim = this.aim();
    if (aim) list.push({ ...view(aim), kind: 'aim', grab: AIM_ID });
    return list;
  });

  protected readonly segments = computed((): Segment[] => {
    const step = this.step();
    if (step === 'corners') {
      const points = orderCorners(this.corners());
      return points.map((a, i) => ({ a, b: points[(i + 1) % points.length], kind: 'edge' }));
    }
    const [a, b] = this.segment();
    if (step !== 'scale' || !a || !b) return [];
    const view = this.toView();
    const mm = this.mm();
    return [{ a: view(a), b: view(b), kind: 'ruler', label: mm ? `${numText(mm)} мм` : undefined }];
  });

  ngOnInit(): void {
    const flat = this.flat();
    const flatSrc = this.flatSrc();
    if (flat && flatSrc) this.picture.set({ flat, src: flatSrc });
    this.kind.set(this.element());
    const saved = this.saved();
    if (saved) this.restore(saved);
    else this.resize(this.count());
    if (!saved?.corners) this.corners.set(this.startingCorners());
  }

  ngOnDestroy(): void {
    this.generation++;
    if (this.ownUrl) URL.revokeObjectURL(this.ownUrl);
  }

  private restore(marks: ManualMarks): void {
    if (marks.corners) {
      this.corners.set(marks.corners);
      this.cornersSet.set(true);
    }
    this.segment.set(marks.segment);
    this.mmText.set(marks.mm != null ? numText(marks.mm) : '');
    this.centres.set(marks.centres);
    this.aim.set(marks.aim);
    this.edge.set(marks.edge);
    this.kind.set(marks.element);
    this.sized.set(marks.sized);
  }

  private startingCorners(): Point[] {
    const plane = this.plane();
    if (plane?.homography && plane.scale.sheet) {
      return sheetCorners(plane.homography, plane.scale.sheet);
    }
    return frameCorners(this.imageSize());
  }

  protected resize(count: number): void {
    const size = Math.min(MAX_TARGETS, Math.max(1, count));
    this.centres.update((centres) => Array.from({ length: size }, (_, i) => centres[i] ?? null));
    this.selectedMark.set(null);
  }

  protected async goTo(step: Step): Promise<void> {
    this.step.set(step);
    this.hint.set(null);
    this.selectedMark.set(null);
    this.placingAim.set(false);
    if (step !== 'corners') await this.rectify();
  }

  /** The picture is made anew only when the corners have moved since the last time. */
  private async rectify(): Promise<void> {
    const plane = this.cornersPlane();
    if (!this.stale || !plane) return;
    this.stale = false;
    const generation = ++this.generation;
    this.busy.set(true);
    try {
      const image = await readPixels(this.photo());
      const { flat } = await this.detector.warp({
        kind: 'warp',
        image,
        homography: plane.matrix,
        sheet: plane.sheet,
      });
      const src = await flatUrl(flat);
      if (generation !== this.generation) {
        URL.revokeObjectURL(src);
        return;
      }
      if (this.ownUrl) URL.revokeObjectURL(this.ownUrl);
      this.ownUrl = src;
      this.warped = flat;
      this.picture.set({ flat, src });
    } catch {
      // The marks are kept in pixels of the shot, so the original serves just as well.
      if (generation === this.generation) this.picture.set(null);
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  protected resetCorners(): void {
    this.cornersSet.set(false);
    this.stale = false;
    this.picture.set(null);
    this.warped = null;
    const flat = this.flat();
    const flatSrc = this.flatSrc();
    if (flat && flatSrc) this.picture.set({ flat, src: flatSrc });
    this.corners.set(this.startingCorners());
  }

  protected resetSegment(): void {
    this.segment.set([]);
    this.selectedMark.set(null);
    this.hint.set(null);
  }

  protected toggleAim(): void {
    if (this.aim()) this.aim.set(null);
    else this.placingAim.update((placing) => !placing);
    this.hint.set(null);
  }

  protected added(tap: TargetTap): void {
    const at = this.fromView()(tap.at);
    this.selectedMark.set(null);
    this.hint.set(null);
    if (this.step() === 'scale') {
      this.segment.update((points) => applyMarkEvent(points, { ...tap, type: 'add', at }, 2));
    } else if (this.step() === 'targets') {
      this.placeOnTargets(tap, at);
    }
  }

  private placeOnTargets(tap: TargetTap, at: Point): void {
    if (this.placingAim()) {
      this.aim.set(at);
      this.placingAim.set(false);
      return;
    }
    const slot = this.centres().indexOf(null);
    if (slot < 0) return;
    this.centres.update((centres) => centres.map((p, i) => (i === slot ? at : p)));
    if (slot === 0 && !this.edge()) this.edge.set(this.startingEdge(tap));
  }

  /** The element keeps the size the template already has, if any. */
  private startingEdge({ at }: TargetTap): Point {
    const halfMm = (this.elementMm() ?? 0) / 2;
    const flat = this.flatShown();
    const perMm = flat ? flat.k : (this.reading()?.pxPerMm ?? 0);
    const { w, h } = this.imageSize();
    const r = halfMm && perMm ? halfMm * perMm : Math.min(w, h) * DEFAULT_RADIUS;
    return this.fromView()({ x: at.x + r, y: at.y });
  }

  protected refused(): void {
    switch (this.step()) {
      case 'corners':
        this.hint.set('Углов ровно четыре — тяните маркеры');
        break;
      case 'scale':
        this.hint.set('Тяните точки, чтобы поправить');
        break;
      case 'targets':
        this.hint.set(`Отмечены все мишени: ${this.centres().length}. Лишние касания не считаются`);
        break;
    }
  }

  protected moved({ id, at }: MarkMove): void {
    const point = this.fromView()(at);
    this.hint.set(null);
    switch (this.step()) {
      case 'corners':
        this.corners.update((list) =>
          applyMarkEvent(list, { type: 'move', id, at }, CORNER_POINTS),
        );
        this.cornersSet.set(true);
        this.stale = true;
        break;
      case 'scale':
        this.segment.update((list) =>
          applyMarkEvent(list, { type: 'move', id, at: point }, SEGMENT_POINTS),
        );
        break;
      case 'targets':
        this.moveOnTargets(id, at, point);
        break;
    }
  }

  private moveOnTargets(id: number, seen: Point, point: Point): void {
    if (id === EDGE_ID) {
      this.edge.set(point);
      this.sized.set(true);
      return;
    }
    if (id === AIM_ID) {
      this.aim.set(point);
      return;
    }
    if (id === 0) this.carryEdge(seen);
    this.centres.update((centres) => centres.map((p, i) => (i === id ? point : p)));
  }

  /** The edge handle travels with the first centre, so the size stays what it was. */
  private carryEdge(seen: Point): void {
    const [first] = this.centres();
    const edge = this.edge();
    if (!first || !edge) return;
    const view = this.toView();
    const [from, handle] = [view(first), view(edge)];
    this.edge.set(
      this.fromView()({ x: handle.x + seen.x - from.x, y: handle.y + seen.y - from.y }),
    );
  }

  protected removeMark(id: number): void {
    this.selectedMark.set(null);
    this.hint.set(null);
    if (id === EDGE_ID) return;
    if (id === AIM_ID) {
      const aim = this.aim();
      this.aim.set(null);
      this.undo().show('Убрано', () => this.aim.set(aim));
    } else if (this.step() === 'scale') {
      const removed = this.segment()[id];
      this.segment.update((list) => applyMarkEvent(list, { type: 'remove', id }, SEGMENT_POINTS));
      this.undo().show('Убрано', () => {
        if (this.segment().length >= SEGMENT_POINTS) return;
        this.segment.update((list) => [...list.slice(0, id), removed, ...list.slice(id)]);
      });
    } else if (this.step() === 'targets') {
      this.removeCentre(id);
    }
  }

  private removeCentre(id: number): void {
    const removed = this.centres()[id];
    const edge = this.edge();
    this.centres.update((centres) => centres.map((p, i) => (i === id ? null : p)));
    if (id === 0) this.edge.set(null);
    this.undo().show('Убрано', () => {
      if (this.centres()[id]) return;
      this.centres.update((centres) => centres.map((p, i) => (i === id ? removed : p)));
      if (id === 0) this.edge.set(edge);
    });
  }

  protected async finish(): Promise<void> {
    const marks = this.current();
    const reading = this.reading();
    if (marks.segment.length === SEGMENT_POINTS && !reading) {
      this.error.set('Укажите длину отрезка.');
      await this.goTo('scale');
      return;
    }
    if (this.marked() && !canMeasure(marks, this.matrix())) {
      this.error.set('Задайте масштаб или углы листа: без них мишени не перевести в миллиметры.');
      await this.goTo('scale');
      return;
    }
    if (!marks.corners && !reading && !this.marked()) {
      this.closed.emit();
      return;
    }
    this.error.set(null);
    await this.rectify();
    this.done.emit({
      marks,
      plane: this.cornersPlane(),
      flat: this.warped,
      layout: manualLayout(marks, this.matrix(), this.onSheet(), this.activeSheet()),
      scaled: !!reading,
    });
  }
}
