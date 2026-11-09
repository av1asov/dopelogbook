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
  SheetSize,
  TargetReference,
  TargetTemplate,
  TemplateTarget,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { shrinkPhoto } from '../../core/image';
import { FlatImage, SurveyResult } from '../../core/target/detect';
import { flatUrl, readPixels, TargetDetector } from '../../core/target/detector';
import { referenceText, SHEETS } from '../../core/target/measure';
import { ISSUE_TEXT } from '../../core/target/quality';
import { SignedInput } from '../../shared/signed-input';
import { TargetPreview } from '../../shared/target-preview';
import { Marker, TargetView } from '../../shared/target-view';

type Kind = TargetReference['kind'];
type Order = 'rows' | 'columns';
type Section = 'count' | 'reference' | 'aim' | 'order';

const text = (value = '') => new FormControl(value, { nonNullable: true });

const KINDS: readonly (readonly [Kind, string, string])[] = [
  ['square', 'Квадрат', 'Сторона чёрного квадрата, мм'],
  ['circle', 'Круг', 'Диаметр чёрного круга, мм'],
  ['grid', 'Сетка', 'Шаг сетки, мм'],
  ['rings', 'Кольца', 'Диаметры колец через пробел, мм'],
];

const ROW_GAP = 15;

function numbered<T extends Point>(places: readonly T[], order: Order): T[] {
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

  /** Route parameter; absent for a new template. A standard one opens as a copy. */
  readonly id = input<string>();
  /** The photo to take the template from, when opened from the marking screen. */
  readonly photo = input<Blob | null>(null);
  readonly overlay = input(false);

  readonly saved = output<TargetTemplate>();
  readonly closed = output<void>();

  protected readonly kinds = KINDS;
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
    this.store.targets().find((t) => t.id === this.id() && !t.builtin),
  );
  private readonly source = computed(() => this.store.targets().find((t) => t.id === this.id()));

  private readonly sheet = computed((): SheetSize => {
    const { sheetW, sheetH } = this.value();
    return { w: parseNum(sheetW) ?? 0, h: parseNum(sheetH) ?? 0 };
  });

  protected readonly sheetHint = computed(() => {
    const { w, h } = this.sheet();
    return `${numText(w)} × ${numText(h)} мм — по этому размеру выпрямляется снимок`;
  });

  private sizes(value: string): number[] {
    return value
      .split(/[\s;/]+/)
      .map(parseNum)
      .filter((n): n is number => n != null && n > 0);
  }

  private readonly reference = computed((): TargetReference | null => {
    const { kind, size } = this.value();
    const sizes = this.sizes(size);
    if (!sizes.length) return null;
    if (kind === 'rings') return { kind, diameters: sizes };
    if (kind === 'grid') return { kind, step: sizes[0] };
    return { kind, size: sizes[0] };
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
  protected readonly orderLabel = computed(() =>
    this.order() === 'rows' ? 'слева направо, сверху вниз' : 'сверху вниз, слева направо',
  );

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
      reference?.kind === 'square' || reference?.kind === 'circle' ? reference.size / 2 + 4 : 15;
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
    if (issue) return ISSUE_TEXT[issue];
    return result.targets ? null : 'Мишени на листе не найдены. Задайте их ниже или переснимите.';
  });

  private readonly blocked = computed(() => {
    const result = this.survey();
    return !!this.blob() && (!result?.plane || !!result.quality?.issues.length);
  });

  ngOnInit(): void {
    const source = this.source();
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
      name: source.builtin ? `${source.name} (копия)` : source.name,
      sheetW: numText(source.sheet.w),
      sheetH: numText(source.sheet.h),
      kind: reference?.kind ?? 'square',
      size: !reference
        ? ''
        : reference.kind === 'rings'
          ? reference.diameters.map(numText).join(' ')
          : numText(reference.kind === 'grid' ? reference.step : reference.size),
      aimUp: numText(first?.aim?.up ?? 0),
      aimRight: numText(first?.aim?.right ?? 0),
    });
    this.places.set(source.targets.map(({ x, y }) => ({ x, y })));
    this.syncPreset();
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
    const { reference } = first;
    this.form.patchValue({
      kind: reference.kind,
      size:
        reference.kind === 'rings'
          ? reference.diameters.map(numText).join(' ')
          : numText(reference.kind === 'grid' ? reference.step : reference.size),
    });
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
    const template = await this.store.save('target', {
      ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
      name,
      sheet,
      targets,
    });
    if (this.overlay()) this.saved.emit(template);
    else await this.router.navigate(['/more/targets']);
  }

  protected async remove(): Promise<void> {
    const existing = this.existing();
    if (!existing) return;
    await this.store.remove('target', existing.id);
    await this.router.navigate(['/more/targets']);
  }
}
