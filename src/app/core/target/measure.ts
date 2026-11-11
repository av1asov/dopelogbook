import { numText } from '../ballistics/format';
import {
  ColdShot,
  PhotoMarks,
  PhotoRef,
  PhotoTarget,
  Point,
  Series,
  Session,
  Polarity,
  SheetSize,
  TargetReference,
  TargetRing,
  TargetTemplate,
  TemplateTarget,
} from '../ballistics/model';
import { applyHomography, homography, invertHomography, pxPerMmAt, rectangle } from './homography';

export const SHEETS: readonly (readonly [string, SheetSize])[] = [
  ['A4', { w: 210, h: 297 }],
  ['A3', { w: 297, h: 420 }],
  ['A5', { w: 148, h: 210 }],
  ['Letter', { w: 216, h: 279 }],
];

/** Every edge of the rings, smallest first. */
export const ringDiameters = (rings: readonly TargetRing[]): number[] =>
  rings.flatMap((r) => (r.edge === 'light-ring' ? [r.dIn, r.dOut] : [r.d])).sort((a, b) => a - b);

export const ringsReference = (rings: TargetRing[]): TargetReference => ({
  kind: 'rings',
  diameters: ringDiameters(rings),
  rings,
});

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

/** The radius of a hole `holeMm` across at an image point, in image pixels. */
export function holeRadiusPx(
  marks: Pick<PhotoMarks, 'scale' | 'homography'>,
  at: Point,
  holeMm: number,
): number {
  if (marks.homography) {
    return (holeMm / 2) * pxPerMmAt(marks.homography, applyHomography(marks.homography, at));
  }
  return ((holeMm / 2) * distance(marks.scale.p1, marks.scale.p2)) / marks.scale.mm;
}

/** How many marked photos were measured with a template. */
export const photosWithTemplate = (sessions: readonly Session[], id: string): number =>
  sessions.flatMap((s) => s.photos ?? []).filter((p) => p.marks?.templateId === id).length;

/** The largest distance between two points. */
export function spread(points: readonly Point[]): number | null {
  return farthestPair(points)?.gap ?? null;
}

/** The two points farthest apart, by their indices. */
export function farthestPair(
  points: readonly Point[],
): { i: number; j: number; gap: number } | null {
  if (points.length < 2) return null;
  let best = { i: 0, j: 1, gap: distance(points[0], points[1]) };
  points.forEach((a, i) => {
    points.slice(i + 1).forEach((b, k) => {
      const gap = distance(a, b);
      if (gap > best.gap) best = { i, j: i + 1 + k, gap };
    });
  });
  return best;
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

/** What the photo viewer draws over one target, in the pixels of the original image. */
export interface TargetOverlay {
  n: number;
  si?: number;
  aim: Point | null;
  holes: readonly (Point & { cold?: boolean })[];
  /** Mean point of impact, the cold shot left out. */
  centre: Point | null;
  /** The two holes farthest apart, measured on the target rather than on the photo. */
  pair: [Point, Point] | null;
  /** The distance between them, mm. */
  group: number | null;
}

/** The marks of a photo as they are drawn on it: the mean and the spread are found in mm. */
export function marksOverlay(marks: PhotoMarks): TargetOverlay[] {
  const mm = toMillimetres(marks);
  const inverse = marks.homography && invertHomography(marks.homography);
  return marks.targets.map((target) => {
    const inGroup = target.holes.filter((hole) => !hole.cold);
    const flat = inGroup.map(mm);
    const far = farthestPair(flat);
    const pair: [Point, Point] | null = far && [inGroup[far.i], inGroup[far.j]];
    const mean = meanPoint(flat);
    // Without perspective the scale is linear, so the mean of the pixels is the same point.
    const centre = mean && (inverse ? applyHomography(inverse, mean) : meanPoint(inGroup));
    return {
      n: target.n,
      ...(target.si != null ? { si: target.si } : {}),
      aim: target.aim ?? null,
      holes: target.holes,
      centre,
      pair,
      group: far?.gap ?? null,
    };
  });
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

const uniqueSorted = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

/** Every series a photo is tied to, directly or through a target on a sheet. */
export const photoSeries = (photo: PhotoRef): number[] =>
  uniqueSorted([
    ...(photo.si != null ? [photo.si] : []),
    ...(photo.marks?.targets.flatMap((t) => (t.si != null ? [t.si] : [])) ?? []),
  ]);

/** The series that took their numbers from this photo: without marks it gave them none. */
export const measuredSeries = (photo: PhotoRef): number[] =>
  photo.marks ? photoSeries(photo) : [];

/** The session without the photo; unless kept, the numbers taken from it go too. */
export function withoutPhoto(session: Session, photo: PhotoRef, keepNumbers: boolean): Session {
  const cleared = keepNumbers ? [] : measuredSeries(photo);
  return {
    ...session,
    series: session.series.map((series, si): Series => {
      if (!cleared.includes(si)) return series;
      const { group: _group, offUp: _offUp, offRight: _offRight, ...rest } = series;
      return rest;
    }),
    photos: (session.photos ?? []).filter((p) => p.id !== photo.id),
  };
}

/** «3–5», «1, 3–5»: numbers in order, neighbours joined by a dash. */
export function numberRanges(numbers: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const n of uniqueSorted(numbers)) {
    const last = runs.at(-1);
    if (last && last[1] === n - 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

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
      return `${reference.polarity === 'light' ? 'светлый' : 'чёрный'} квадрат ${numText(reference.size)} мм`;
    case 'circle':
      return `${reference.polarity === 'light' ? 'светлый' : 'чёрный'} круг ${numText(reference.size)} мм`;
    case 'grid':
      return `сетка ${numText(reference.step)} мм`;
    case 'rings':
      // A slash before a digit is no place for a line break by itself: many rings would not fit.
      return `кольца ${reference.diameters.map(numText).join('/\u200b')} мм`;
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
    first ? referenceText(first.reference).replace(/^(чёрный|светлый) /, '') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface FoundElement extends Point {
  kind: 'square' | 'circle' | 'rings';
  /** Side or the largest diameter, mm. */
  size: number;
  polarity?: Polarity;
}

const LAYOUT_TOLERANCE = 12;

/** A point of the sheet after that many quarter turns clockwise. */
export function turnPoint({ w, h }: SheetSize, turns: number, { x, y }: Point): Point {
  if (turns === 1) return { x: h - y, y: x };
  if (turns === 2) return { x: w - x, y: h - y };
  return turns === 3 ? { x: y, y: w - x } : { x, y };
}

type PhotoPlane = Pick<PhotoMarks, 'scale' | 'homography'>;

/**
 * The plane of a photo after quarter turns clockwise. The millimetres turn too: up on the plane
 * has to stay up on the picture, or the offsets would point the old way.
 */
export function turnPlane(
  { scale, homography: matrix }: PhotoPlane,
  photo: SheetSize,
  turns = 1,
): PhotoPlane {
  const inPixels = (p: Point) => turnPoint(photo, turns, p);
  const { sheet } = scale;
  const corners = rectangle(photo.w, photo.h);
  const turned =
    matrix &&
    homography(
      corners.map(inPixels),
      corners.map((p) => turnPoint(sheet ?? { w: 0, h: 0 }, turns, applyHomography(matrix, p))),
    );
  return {
    scale: {
      ...scale,
      p1: inPixels(scale.p1),
      p2: inPixels(scale.p2),
      ...(sheet ? { sheet: turns % 2 ? { w: sheet.h, h: sheet.w } : sheet } : {}),
    },
    ...(turned ? { homography: [...turned] } : {}),
  };
}

/** The point of aim, relative to its target, after quarter turns clockwise. */
export function turnAim(aim: { up: number; right: number }, turns: number) {
  if (turns === 1) return { up: -aim.right, right: aim.up };
  if (turns === 2) return { up: -aim.up, right: -aim.right };
  return turns === 3 ? { up: aim.right, right: -aim.up } : aim;
}

/** Where the targets of a template land when the sheet is turned by quarter turns. */
export function turnedTargets(
  template: Pick<TargetTemplate, 'sheet' | 'targets'>,
  turns: number,
): { sheet: SheetSize; targets: TemplateTarget[] } {
  const { w, h } = template.sheet;
  return {
    sheet: turns % 2 ? { w: h, h: w } : { w, h },
    targets: template.targets.map((t) => ({
      ...t,
      ...turnPoint(template.sheet, turns, t),
      aim: t.aim && turnAim(t.aim, turns),
    })),
  };
}

export interface LayoutFit<T> {
  turn: number;
  /** From the turned template to the found elements, mm. */
  shift: Point;
  targets: TemplateTarget[];
  /** The element of each target, or null. */
  matched: (T | null)[];
  found: number;
}

function matchAt<T extends Point>(
  elements: readonly T[],
  targets: readonly TemplateTarget[],
  shift: Point,
  accepts: (element: T, target: TemplateTarget) => boolean,
  reach: number,
): (T | null)[] {
  const used = new Set<T>();
  return targets.map((target) => {
    const place = { x: target.x + shift.x, y: target.y + shift.y };
    let best: T | null = null;
    let closest = reach;
    for (const element of elements) {
      if (used.has(element) || !accepts(element, target)) continue;
      const gap = distance(element, place);
      if (gap <= closest) [closest, best] = [gap, element];
    }
    if (best) used.add(best);
    return best;
  });
}

const foundIn = (matched: readonly unknown[]): number => matched.filter(Boolean).length;

/**
 * The best placing of the layout for each turn, judged by the targets against each other: a
 * drawing can be printed anywhere on the sheet. Of equal placings, the one moved least wins.
 */
export function fitLayout<T extends Point>(
  elements: readonly T[],
  layout: Pick<TargetTemplate, 'sheet' | 'targets'>,
  turns: readonly number[],
  accepts: (element: T, target: TemplateTarget) => boolean,
  reach: number,
): LayoutFit<T>[] {
  return turns.map((turn) => {
    const { targets } = turnedTargets(layout, turn);
    const shifts: Point[] = [{ x: 0, y: 0 }];
    for (const target of targets) {
      for (const element of elements) {
        if (accepts(element, target)) {
          shifts.push({ x: element.x - target.x, y: element.y - target.y });
        }
      }
    }
    let shift = shifts[0];
    let matched = matchAt(elements, targets, shift, accepts, reach);
    for (const option of shifts.slice(1)) {
      const trial = matchAt(elements, targets, option, accepts, reach);
      const better = foundIn(trial) - foundIn(matched);
      if (
        better > 0 ||
        (better === 0 && Math.hypot(option.x, option.y) < Math.hypot(shift.x, shift.y))
      ) {
        [shift, matched] = [option, trial];
      }
    }
    const pairs = targets.flatMap((target, i) => {
      const element = matched[i];
      return element ? [{ x: element.x - target.x, y: element.y - target.y }] : [];
    });
    if (pairs.length) {
      shift = meanPoint(pairs) as Point;
      matched = matchAt(elements, targets, shift, accepts, reach);
    }
    return { turn, shift, targets, matched, found: foundIn(matched) };
  });
}

/** Whether every target of a template has a printed element in its place on the sheet. */
export function matchesLayout(
  template: Pick<TargetTemplate, 'sheet' | 'targets' | 'artSize'>,
  elements: readonly FoundElement[],
): boolean {
  if (!elements.length) return false;
  if (template.artSize) {
    return (
      elements.length === template.targets.length &&
      fitLayout(elements, template, [0, 1, 2, 3], () => true, LAYOUT_TOLERANCE).some(
        (fit) => fit.found === elements.length,
      )
    );
  }
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
