import { numText } from '../ballistics/format';
import {
  ColdShot,
  PhotoMarks,
  PhotoRef,
  PhotoTarget,
  Point,
  Series,
  Session,
  SheetSize,
  TargetReference,
  TargetTemplate,
  TemplateTarget,
} from '../ballistics/model';
import { applyHomography } from './homography';

const STAMP = '2026-11-09T00:00:00.000Z';
const builtin = { createdAt: STAMP, updatedAt: STAMP, builtin: true } as const;
const CENTRE = { up: 0, right: 0 };

export const SHEETS: readonly (readonly [string, SheetSize])[] = [
  ['A4', { w: 210, h: 297 }],
  ['A3', { w: 297, h: 420 }],
  ['A5', { w: 148, h: 210 }],
  ['Letter', { w: 216, h: 279 }],
];

const A4 = SHEETS[0][1];

export const BUILTIN_TARGETS: readonly TargetTemplate[] = [
  {
    ...builtin,
    id: 'builtin-grid-25',
    name: 'Сетка 25 мм с квадратом',
    sheet: A4,
    targets: [{ n: 1, x: 105, y: 148.5, reference: { kind: 'square', size: 25 }, aim: CENTRE }],
  },
  {
    ...builtin,
    id: 'builtin-rings',
    name: 'Кольцевая',
    sheet: A4,
    targets: [
      {
        n: 1,
        x: 105,
        y: 148.5,
        reference: { kind: 'rings', diameters: [40, 80, 130, 180] },
        aim: CENTRE,
      },
    ],
  },
  {
    ...builtin,
    id: 'builtin-four-squares',
    name: '4 квадрата на A4',
    sheet: A4,
    targets: [
      [55, 80],
      [155, 80],
      [55, 217],
      [155, 217],
    ].map(([x, y], i) => ({
      n: i + 1,
      x,
      y,
      reference: { kind: 'square', size: 30 } as TargetReference,
      aim: CENTRE,
    })),
  },
];

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Maps image pixels to millimetres on the target, the y axis pointing down. */
export function toMillimetres(
  marks: Pick<PhotoMarks, 'scale' | 'homography'>,
): (p: Point) => Point {
  if (marks.homography) {
    const h = marks.homography;
    return (p) => applyHomography(h, p);
  }
  const { p1, p2, mm } = marks.scale;
  const factor = mm / distance(p1, p2);
  return ({ x, y }) => ({ x: x * factor, y: y * factor });
}

/** The largest distance between two points. */
export function spread(points: readonly Point[]): number | null {
  if (points.length < 2) return null;
  let widest = 0;
  points.forEach((a, i) => {
    for (const b of points.slice(i + 1)) widest = Math.max(widest, distance(a, b));
  });
  return widest;
}

export const meanPoint = (points: readonly Point[]): Point | null =>
  points.length
    ? {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
      }
    : null;

export interface Offset {
  /** mm, positive up. */
  offUp: number;
  /** mm, positive right. */
  offRight: number;
}

export interface Measurement {
  /** Between the centres of the two farthest holes, mm. */
  group: number | null;
  /** Mean point of impact from the point of aim. */
  offset: Offset | null;
  cold: Offset | null;
}

export function measureTarget(
  marks: Pick<PhotoMarks, 'scale' | 'homography'>,
  target: Pick<PhotoTarget, 'aim'> & { holes: readonly (Point & { cold?: boolean })[] },
): Measurement {
  const mm = toMillimetres(marks);
  const aim = target.aim ? mm(target.aim) : null;
  const offsetOf = (p: Point): Offset | null =>
    aim ? { offUp: aim.y - p.y, offRight: p.x - aim.x } : null;
  const inGroup = target.holes.filter((hole) => !hole.cold).map(mm);
  const coldHole = target.holes.find((hole) => hole.cold);
  const centre = meanPoint(inGroup);
  return {
    group: spread(inGroup),
    offset: centre && offsetOf(centre),
    cold: coldHole ? offsetOf(mm(coldHole)) : null,
  };
}

/**
 * The target a hole belongs to: the nearest point of aim, unless the hole is farther away than
 * three quarters of the distance between targets, which leaves it outside every target.
 */
export function assignToTargets(holes: readonly Point[], aims: readonly Point[]): number[] {
  const closestPair = aims.flatMap((a, i) => aims.slice(i + 1).map((b) => distance(a, b)));
  const reach = closestPair.length ? Math.min(...closestPair) * 0.75 : Infinity;
  return holes.map((hole) => {
    let nearest = -1;
    let closest = reach;
    aims.forEach((aim, i) => {
      const gap = distance(hole, aim);
      if (gap <= closest) [closest, nearest] = [gap, i];
    });
    return nearest;
  });
}

export interface SeriesOption {
  si: number;
  number: number;
  label: string;
  /** A group is already recorded. */
  filled: boolean;
}

/**
 * Series for targets in order: from the current one (or the first empty one) on, empty series
 * first, then the empty ones before it, then those already filled.
 */
export function defaultSeries(
  count: number,
  options: readonly SeriesOption[],
  current?: number,
): (number | null)[] {
  const start = current ?? options.find((o) => !o.filled)?.si ?? options[0]?.si ?? 0;
  const empty = options.filter((o) => !o.filled);
  const filled = options.filter((o) => o.filled);
  const queue = [
    ...empty.filter((o) => o.si >= start),
    ...empty.filter((o) => o.si < start),
    ...filled.filter((o) => o.si >= start),
    ...filled.filter((o) => o.si < start),
  ];
  return Array.from({ length: count }, (_, i) => queue[i]?.si ?? null);
}

export interface SeriesResult {
  si: number;
  group: number | null;
  offset: Offset | null;
}

/** Writes measured targets into their series and stores the marks with the photo. */
export function withMeasurement(
  session: Session,
  photo: PhotoRef,
  results: readonly SeriesResult[],
  cold?: Omit<ColdShot, 'si'> | null,
): Session {
  const bySeries = new Map(results.map((result) => [result.si, result]));
  const known = (session.photos ?? []).some((p) => p.id === photo.id);
  return {
    ...session,
    series: session.series.map((series, si): Series => {
      const result = bySeries.get(si);
      if (!result) return series;
      return {
        ...series,
        ...(result.group != null ? { group: result.group } : {}),
        ...(result.offset ?? {}),
      };
    }),
    photos: known
      ? (session.photos ?? []).map((p) => (p.id === photo.id ? photo : p))
      : [...(session.photos ?? []), photo],
    ...(cold ? { coldShot: { si: 0, ...cold } } : {}),
  };
}

/** Whether a photo shows this series, directly or as one of the targets on a sheet. */
export const showsSeries = (photo: PhotoRef, si: number): boolean =>
  photo.si === si || (photo.marks?.targets.some((t) => t.si === si) ?? false);

/** «13 мм · ↓10 →9», or «в точку» when the group is on the point of aim. */
export function offsetShort(offset: Offset | null): string {
  if (!offset) return '';
  const up = Math.round(offset.offUp);
  const right = Math.round(offset.offRight);
  if (Math.abs(up) < 1 && Math.abs(right) < 1) return 'в точку';
  return [
    up ? `${up > 0 ? '↑' : '↓'}${Math.abs(up)}` : '',
    right ? `${right > 0 ? '→' : '←'}${Math.abs(right)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function referenceText(reference: TargetReference): string {
  switch (reference.kind) {
    case 'square':
      return `чёрный квадрат ${numText(reference.size)} мм`;
    case 'circle':
      return `чёрный круг ${numText(reference.size)} мм`;
    case 'grid':
      return `сетка ${numText(reference.step)} мм`;
    case 'rings':
      return `кольца ${reference.diameters.map(numText).join('/')} мм`;
  }
}

export function sheetName({ w, h }: SheetSize): string {
  return SHEETS.find(([, s]) => s.w === w && s.h === h)?.[0] ?? `${numText(w)}×${numText(h)}`;
}

const targetCount = (n: number): string => {
  const units = n % 10;
  const tens = n % 100;
  if (units === 1 && tens !== 11) return `${n} мишень`;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? `${n} мишени` : `${n} мишеней`;
};

/** «A4 · 4 мишени · квадрат 30 мм» */
export function templateText(template: Pick<TargetTemplate, 'sheet' | 'targets'>): string {
  const first = template.targets[0];
  return [
    sheetName(template.sheet),
    targetCount(template.targets.length),
    first ? referenceText(first.reference).replace('чёрный ', '') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface FoundElement extends Point {
  kind: 'square' | 'circle';
  size: number;
}

const LAYOUT_TOLERANCE = 12;

/** Where the targets of a template land when the sheet is turned by quarter turns. */
export function turnedTargets(
  template: Pick<TargetTemplate, 'sheet' | 'targets'>,
  turns: number,
): { sheet: SheetSize; targets: TemplateTarget[] } {
  const { w, h } = template.sheet;
  const turnPoint = ({ x, y }: Point): Point => {
    if (turns === 1) return { x: h - y, y: x };
    if (turns === 2) return { x: w - x, y: h - y };
    return turns === 3 ? { x: y, y: w - x } : { x, y };
  };
  const turnAim = (aim: TemplateTarget['aim']): TemplateTarget['aim'] => {
    if (!aim) return aim;
    if (turns === 1) return { up: -aim.right, right: aim.up };
    if (turns === 2) return { up: -aim.up, right: -aim.right };
    return turns === 3 ? { up: aim.right, right: -aim.up } : aim;
  };
  return {
    sheet: turns % 2 ? { w: h, h: w } : { w, h },
    targets: template.targets.map((t) => ({ ...t, ...turnPoint(t), aim: turnAim(t.aim) })),
  };
}

/** Whether every target of a template has a printed element in its place on the sheet. */
export function matchesLayout(
  template: Pick<TargetTemplate, 'sheet' | 'targets'>,
  elements: readonly FoundElement[],
): boolean {
  if (!elements.length) return false;
  return [0, 1, 2, 3].some((turns) => {
    const { targets } = turnedTargets(template, turns);
    return (
      targets.length === elements.length &&
      targets.every((t) => elements.some((e) => distance(e, t) < LAYOUT_TOLERANCE))
    );
  });
}

const INCH = 25.4;
const DEFAULT_CALIBER = 7.82;

/** Bullet diameter, mm, from free text such as «.308», «308 Win», «6,5×47» or «9 мм». */
export function caliberMm(text: string | null | undefined): number {
  const value = (text ?? '').replace(',', '.');
  const inches = /(?:^|[^\d])\.(\d{3})/.exec(value);
  if (inches) return (Number(inches[1]) / 1000) * INCH;
  const metric = /(\d{1,2}\.\d{1,2}|\b\d{1,2}(?=\s*(?:мм|mm)))/i.exec(value);
  if (metric) return Number(metric[1]);
  const named = /\b([1-5]\d{2})\b/.exec(value);
  return named ? (Number(named[1]) / 1000) * INCH : DEFAULT_CALIBER;
}
