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
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { map } from 'rxjs';
import {
  numText,
  parseNum,
  Point,
  Polarity,
  SheetSize,
  TargetReference,
  TargetRing,
  TargetTemplate,
  TemplateTarget,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { shrinkPhoto } from '../../core/image';
import { FlatImage, SurveyResult } from '../../core/target/detect';
import { flatUrl, readPixels, TargetDetector } from '../../core/target/detector';
import {
  photosWithTemplate,
  referenceText,
  ringsReference,
  SHEETS,
} from '../../core/target/measure';
import { issueText } from '../../core/target/quality';
import { SignedInput } from '../../shared/signed-input';
import { TargetPreview } from '../../shared/target-preview';
import { Marker, TargetView } from '../../shared/target-view';

type Kind = TargetReference['kind'];
type Order = 'rows' | 'columns' | 'printed';
/** `line`: a thin printed circle, with nothing to tell about the sides of it. */
type RingKind = TargetRing['edge'] | 'line';

interface RingRow {
  edge: RingKind;
  d: string;
  dIn: string;
  dOut: string;
}

const emptyRing = (edge: RingKind = 'light-disc'): RingRow => ({ edge, d: '', dIn: '', dOut: '' });
type Section = 'count' | 'reference' | 'aim' | 'order';

const text = (value = '') => new FormControl(value, { nonNullable: true });

const KINDS: readonly (readonly [Kind, string, string])[] = [
  ['square', 'Квадрат', 'Сторона квадрата, мм'],
  ['circle', 'Круг', 'Диаметр круга, мм'],
  ['grid', 'Сетка', 'Шаг сетки, мм'],
  ['rings', 'Кольца', ''],
];

const RING_KINDS: readonly (readonly [RingKind, string])[] = [
  ['light-disc', 'Граница светлого круга'],
  ['dark-disc', 'Граница тёмного круга'],
  ['light-ring', 'Белое кольцо'],
  ['line', 'Тонкая линия'],
];

function ringRows(reference: Extract<TargetReference, { kind: 'rings' }>): RingRow[] {
  if (!reference.rings) {
    return reference.diameters.map((d) => ({ ...emptyRing('line'), d: numText(d) }));
  }
  return reference.rings.map((ring) =>
    ring.edge === 'light-ring'
      ? { ...emptyRing(ring.edge), dIn: numText(ring.dIn), dOut: numText(ring.dOut) }
      : { ...emptyRing(ring.edge), d: numText(ring.d) },
  );
}

function ringsFrom(rows: readonly RingRow[]): TargetReference | null {
  const positive = (text: string) => {
    const value = parseNum(text);
    return value != null && value > 0 ? value : null;
  };
  const rings: TargetRing[] = [];
  const lines: number[] = [];
  for (const row of rows) {
    if (row.edge === 'light-ring') {
      const [dIn, dOut] = [positive(row.dIn), positive(row.dOut)];
      if (dIn != null && dOut != null && dIn < dOut) rings.push({ edge: row.edge, dIn, dOut });
      continue;
    }
    const d = positive(row.d);
    if (d == null) continue;
    if (row.edge === 'line') lines.push(d);
    else rings.push({ edge: row.edge, d });
  }
  if (lines.length) {
    const all = [
      ...lines,
      ...rings.flatMap((r) => (r.edge === 'light-ring' ? [r.dIn, r.dOut] : [r.d])),
    ];
    return { kind: 'rings', diameters: all.sort((a, b) => a - b) };
  }
  return rings.length ? ringsReference(rings) : null;
}

const ROW_GAP = 15;

function numbered<T extends Point>(places: readonly T[], order: Order): T[] {
  if (order === 'printed') return [...places];
  return [...places].sort((a, b) =>
    order === 'rows'
      ? Math.abs(a.y - b.y) < ROW_GAP
        ? a.x - b.x
        : a.y - b.y
      : Math.abs(a.x - b.x) < ROW_GAP
        ? a.y - b.y
        : a.x - b.x,
  );
}

/** Evenly spread over the sheet: the layout of a template made without a photo. */
function evenPlaces(sheet: SheetSize, columns: number, rows: number): Point[] {
  return Array.from({ length: columns * rows }, (_, i) => ({
    x: Math.round(((i % columns) + 0.5) * (sheet.w / columns) * 2) / 2,
    y: Math.round((Math.floor(i / columns) + 0.5) * (sheet.h / rows) * 2) / 2,
  }));
}

/** Screen 16: a template, proposed from a photo of a blank sheet or filled in by hand. */
@Component({
  selector: 'app-target-editor',
  imports: [ReactiveFormsModule, SignedInput, TargetPreview, TargetView],
  templateUrl: './target-editor.html',
  styleUrl: './target-editor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetEditor implements OnInit, OnDestroy {
  private readonly store = inject(DiaryStore);
  private readonly router = inject(Router);
  private readonly detector = inject(TargetDetector);

  /** Route parameter; absent for a new template. */
  readonly id = input<string>();
  /** The photo to take the template from, when opened from the marking screen. */
  readonly photo = input<Blob | null>(null);
  readonly overlay = input(false);

  readonly saved = output<TargetTemplate>();
  readonly closed = output<void>();

  protected readonly kinds = KINDS;
  protected readonly ringKinds = RING_KINDS;
  protected readonly ringRows = signal<RingRow[]>([emptyRing()]);
  protected readonly sheets = SHEETS;
  protected readonly order = signal<Order>('rows');
  protected readonly open = signal<Section | null>(null);
  protected readonly places = signal<Point[]>(evenPlaces(SHEETS[0][1], 1, 1));
  protected readonly preset = signal('A4');

  protected readonly form = new FormGroup({
    name: text(),
    sheetW: text('210'),
    sheetH: text('297'),
    columns: text('1'),
    rows: text('1'),
    kind: new FormControl<Kind>('square', { nonNullable: true }),
    size: text('25'),
    polarity: new FormControl<Polarity>('dark', { nonNullable: true }),
    artW: text(),
    artH: text(),
    aimUp: text('0'),
    aimRight: text('0'),
  });

  private readonly value = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  protected readonly blob = signal<Blob | null>(null);
  protected readonly src = signal<string | null>(null);
  protected readonly flat = signal<FlatImage | null>(null);
  protected readonly flatSrc = signal<string | null>(null);
  private readonly imageSize = signal({ w: 0, h: 0 });
  protected readonly straight = signal(true);
  protected readonly busy = signal(false);
  private readonly survey = signal<SurveyResult | null>(null);
  protected readonly confirmingDelete = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly existing = computed(() =>
    this.store.targets().find((t) => t.id === this.id()),
  );
  /** Marked photos keep the id of their template, so it stays while there are any. */
  protected readonly photoCount = computed(() => {
    const existing = this.existing();
    return existing ? photosWithTemplate(this.store.diary().sessions, existing.id) : 0;
  });

  private readonly sheet = computed((): SheetSize => {
    const { sheetW, sheetH } = this.value();
    return { w: parseNum(sheetW) ?? 0, h: parseNum(sheetH) ?? 0 };
  });

  protected readonly sheetHint = computed(() => {
    const { w, h } = this.sheet();
    return `${numText(w)} × ${numText(h)} мм — по этому размеру выпрямляется снимок`;
  });

  private readonly artSize = computed((): SheetSize | null => {
    const { artW, artH } = this.value();
    const [w, h] = [parseNum(artW), parseNum(artH)];
    return w != null && h != null && w > 0 && h > 0 ? { w, h } : null;
  });

  private readonly reference = computed((): TargetReference | null => {
    const { kind, size, polarity } = this.value();
    if (kind === 'rings') return ringsFrom(this.ringRows());
    const value = parseNum(size);
    if (value == null || value <= 0) return null;
    if (kind === 'grid') return { kind, step: value };
    return { kind, size: value, ...(polarity === 'light' ? { polarity } : {}) };
  });

  private readonly targets = computed((): TemplateTarget[] => {
    const reference = this.reference();
    if (!reference) return [];
    const { aimUp, aimRight } = this.value();
    const aim = { up: parseNum(aimUp) ?? 0, right: parseNum(aimRight) ?? 0 };
    return numbered(this.places(), this.order()).map((place, i) => ({
      n: i + 1,
      x: place.x,
      y: place.y,
      reference,
      aim,
    }));
  });

  protected readonly draft = computed(() => ({ sheet: this.sheet(), targets: this.targets() }));

  protected readonly sizeLabel = computed(
    () => KINDS.find(([kind]) => kind === this.value().kind)?.[2] ?? '',
  );
  protected readonly countText = computed(() => {
    const count = this.places().length;
    const xs = new Set(this.places().map((p) => Math.round(p.x / ROW_GAP))).size;
    const ys = new Set(this.places().map((p) => Math.round(p.y / ROW_GAP))).size;
    return count > 1 && xs * ys === count ? `${count} · сетка ${xs} × ${ys}` : String(count);
  });
  protected readonly referenceLabel = computed(() => {
    const reference = this.reference();
    return reference ? referenceText(reference) : 'укажите размер';
  });
  protected readonly aimLabel = computed(() => {
    const { aimUp, aimRight, kind } = this.value();
    const centred = !parseNum(aimUp) && !parseNum(aimRight);
    if (!centred) return 'смещена от центра';
    return kind === 'square' ? 'центр квадрата' : kind === 'circle' ? 'центр круга' : 'центр';
  });
  protected readonly orderLabel = computed(() => {
    const order = this.order();
    if (order === 'printed') return 'как напечатано';
    return order === 'rows' ? 'слева направо, сверху вниз' : 'сверху вниз, слева направо';
  });

  private readonly flatShown = computed(() => (this.straight() ? this.flat() : null));
  protected readonly viewSrc = computed(() => (this.flatShown() ? this.flatSrc() : this.src()));
  protected readonly viewWidth = computed(() => this.flatShown()?.width ?? this.imageSize().w);
  protected readonly viewHeight = computed(() => this.flatShown()?.height ?? this.imageSize().h);
  protected readonly viewAspect = computed(() =>
    this.viewHeight() ? this.viewWidth() / this.viewHeight() : 1,
  );

  /** Frames and numbers on the rectified sheet; the original keeps its own geometry. */
  protected readonly markers = computed((): Marker[] => {
    const flat = this.flatShown();
    if (!flat || !this.survey()?.plane?.scale.sheet) return [];
    const reference = this.reference();
    const half =
      reference?.kind === 'square' || reference?.kind === 'circle'
        ? reference.size / 2 + 4
        : reference?.kind === 'rings'
          ? Math.max(...reference.diameters) / 2 + 4
          : 15;
    return this.targets().flatMap((t): Marker[] => {
      const x = (t.x - flat.x0) * flat.k;
      const y = (t.y - flat.y0) * flat.k;
      const r = half * flat.k;
      return [
        { x, y, r, kind: 'frame' },
        { x: x - r - 8 * flat.k, y: y - r - 3 * flat.k, kind: 'number', label: String(t.n) },
      ];
    });
  });

  protected readonly statusText = computed(() => {
    const result = this.survey();
    if (!result?.plane || !result.quality) return null;
    const by = result.plane.scale.source === 'sheet' ? 'по 4 углам листа' : 'по карте';
    const flat = result.quality.issues.includes('bent') ? '' : ' · лист ровный ✓';
    return `Выпрямлено ${by} · наклон ${Math.round(result.quality.tilt)}°${flat}`;
  });

  /** Mistakes here would reach every future photo, so a doubtful shot is not accepted. */
  protected readonly problem = computed(() => {
    if (!this.blob() || this.busy()) return null;
    const result = this.survey();
    if (!result) return null;
    if (!result.plane) {
      return 'Не видно углов листа и нет карты в кадре. Снимите так, чтобы были видны 4 угла, или положите банковскую карту.';
    }
    const [issue] = result.quality?.issues ?? [];
    if (issue) return issueText(issue);
    return result.targets ? null : 'Мишени на листе не найдены. Задайте их ниже или переснимите.';
  });

  private readonly blocked = computed(() => {
    const result = this.survey();
    return !!this.blob() && (!result?.plane || !!result.quality?.issues.length);
  });

  ngOnInit(): void {
    const source = this.existing();
    if (source) this.load(source);
    const photo = this.photo();
    if (photo) void this.usePhoto(photo);
  }

  ngOnDestroy(): void {
    for (const url of [this.src(), this.flatSrc()]) if (url) URL.revokeObjectURL(url);
  }

  private load(source: TargetTemplate): void {
    const [first] = source.targets;
    const reference = first?.reference;
    this.form.patchValue({
      name: source.name,
      sheetW: numText(source.sheet.w),
      sheetH: numText(source.sheet.h),
      artW: source.artSize ? numText(source.artSize.w) : '',
      artH: source.artSize ? numText(source.artSize.h) : '',
      aimUp: numText(first?.aim?.up ?? 0),
      aimRight: numText(first?.aim?.right ?? 0),
    });
    if (reference) this.applyReference(reference);
    this.order.set(source.numbering === 'printed' ? 'printed' : 'rows');
    this.places.set([...source.targets].sort((a, b) => a.n - b.n).map(({ x, y }) => ({ x, y })));
    this.syncPreset();
  }

  private applyReference(reference: TargetReference): void {
    this.form.patchValue({ kind: reference.kind });
    if (reference.kind === 'rings') {
      this.ringRows.set(ringRows(reference));
    } else if (reference.kind === 'grid') {
      this.form.patchValue({ size: numText(reference.step) });
    } else {
      this.form.patchValue({
        size: numText(reference.size),
        polarity: reference.polarity ?? 'dark',
      });
    }
  }

  protected addRing(): void {
    this.ringRows.update((rows) => [...rows, emptyRing()]);
  }

  protected removeRing(index: number): void {
    this.ringRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected changeRing(index: number, change: Partial<RingRow>): void {
    this.ringRows.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  private syncPreset(): void {
    const { w, h } = this.sheet();
    const match = SHEETS.find(([, s]) => (s.w === w && s.h === h) || (s.w === h && s.h === w));
    this.preset.set(match?.[0] ?? 'custom');
  }

  protected toggle(section: Section): void {
    this.open.update((current) => (current === section ? null : section));
  }

  protected choosePreset(name: string): void {
    this.preset.set(name);
    const size = SHEETS.find(([preset]) => preset === name)?.[1];
    if (!size) return;
    const { w, h } = this.sheet();
    const flipped = w > h;
    this.form.patchValue({
      sheetW: String(flipped ? size.h : size.w),
      sheetH: String(flipped ? size.w : size.h),
    });
    this.afterSheetChange();
  }

  protected afterSheetChange(): void {
    this.syncPreset();
    if (this.blob()) void this.runSurvey();
    else this.layOut();
  }

  /** Spreads the chosen number of targets over the sheet. */
  protected layOut(): void {
    const { columns, rows } = this.value();
    const [c, r] = [parseNum(columns) ?? 1, parseNum(rows) ?? 1];
    const sheet = this.sheet();
    if (c < 1 || r < 1 || !sheet.w || !sheet.h) return;
    this.places.set(evenPlaces(sheet, Math.round(c), Math.round(r)));
  }

  protected async choosePhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.usePhoto(await shrinkPhoto(file));
  }

  private async usePhoto(blob: Blob): Promise<void> {
    this.blob.set(blob);
    const bitmap = await createImageBitmap(blob);
    this.imageSize.set({ w: bitmap.width, h: bitmap.height });
    bitmap.close();
    const old = this.src();
    if (old) URL.revokeObjectURL(old);
    this.src.set(URL.createObjectURL(blob));
    await this.runSurvey();
  }

  private async runSurvey(): Promise<void> {
    const blob = this.blob();
    if (!blob) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.detector.survey({
        kind: 'survey',
        image: await readPixels(blob),
        sheet: this.sheet(),
      });
      this.survey.set(result);
      await this.showFlat(result.flat);
      this.adopt(result);
    } catch {
      this.error.set('Автопоиск недоступен — задайте мишени вручную.');
      this.blob.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  private async showFlat(flat: FlatImage | null): Promise<void> {
    const old = this.flatSrc();
    if (old) URL.revokeObjectURL(old);
    this.flatSrc.set(flat ? await flatUrl(flat) : null);
    this.flat.set(flat && { ...flat, data: new Uint8ClampedArray() });
  }

  private adopt({ sheet, targets }: SurveyResult): void {
    if (sheet) {
      this.form.patchValue({ sheetW: numText(sheet.w), sheetH: numText(sheet.h) });
      this.syncPreset();
    }
    const [first] = targets ?? [];
    if (!targets || !first) return;
    this.applyReference(first.reference);
    this.places.set(targets.map(({ x, y }) => ({ x, y })));
  }

  protected cancel(): void {
    if (this.overlay()) this.closed.emit();
    else void this.router.navigate(['/more/targets']);
  }

  protected async submit(): Promise<void> {
    const name = this.value().name.trim();
    if (!name) {
      this.error.set('Дайте мишени название.');
      return;
    }
    const { sheet, targets } = this.draft();
    if (!targets.length || !sheet.w || !sheet.h) {
      this.error.set('Укажите размер листа и опорного элемента.');
      return;
    }
    if (this.blocked()) {
      this.error.set('Переснимите лист: по такому снимку шаблон будет неточным.');
      return;
    }
    const existing = this.existing();
    const artSize = this.artSize();
    const template = await this.store.save('target', {
      ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
      name,
      sheet,
      ...(artSize ? { artSize } : {}),
      targets,
      ...(this.order() === 'printed' ? { numbering: 'printed' as const } : {}),
    });
    if (this.overlay()) this.saved.emit(template);
    else await this.router.navigate(['/more/targets']);
  }

  protected async remove(): Promise<void> {
    const existing = this.existing();
    if (!existing || this.photoCount()) return;
    await this.store.remove('target', existing.id);
    await this.router.navigate(['/more/targets']);
  }
}
