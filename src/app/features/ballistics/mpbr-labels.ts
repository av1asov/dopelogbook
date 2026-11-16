import { fmt, fmtSigned, MpbrLine } from '../../core/ballistics';

/** m, whole; at least 1 m: «0–194» is written «194». */
export function entryText(entry: number): string {
  return fmt(Math.max(1, Math.round(entry)), 0);
}

/** «3–194» when the bullet rises into the zone past the muzzle, else «194». */
export function rangeText(line: MpbrLine): string {
  if (line.mpbr == null) return '—';
  const far = fmt(line.mpbr, 0);
  return line.entry != null ? `${entryText(line.entry)}–${far}` : far;
}

/** Heights over the line of sight, mm. */
export interface ChartPoint {
  d: number;
  h: number;
}

/** A journal measurement moved to the chosen zero: where the bullet really went. */
export interface ChartFact {
  d: number;
  h: number;
  /** Half the whisker, mm. */
  spread: number;
}

/** The chart's box, in SVG units: one unit is one CSS pixel on a 393 pt wide phone. */
export const CHART = {
  W: 361,
  H: 150,
  LEFT: 24,
  RIGHT: 349,
  MID: 70,
  TOP: 8,
  BOTTOM: 132,
  /** The zone is always drawn this many pixels from the line to its edge. */
  ZONE_PX: 26,
} as const;

/** Spec: labels are never smaller than 11 px. */
export const LABEL_FONT = 11;
/** From the edge of the marker to the label, px. */
const GAP = 4;
/** Around the text inside its box, px, so a slightly wider font still does not touch. */
const PAD = 1;
const LABEL_H = LABEL_FONT + 2 * PAD;
/** Baseline from the top of the box: cap height of an 11 px font plus the padding. */
const BASELINE = PAD + 9;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scale {
  /** m */
  axis: number;
  /** mm */
  radius: number;
}

export const xOf = (s: Scale, d: number): number =>
  CHART.LEFT + ((CHART.RIGHT - CHART.LEFT) * d) / s.axis;
export const yOf = (s: Scale, h: number): number => CHART.MID - (h * CHART.ZONE_PX) / s.radius;
export const clampY = (s: Scale, h: number): number =>
  Math.min(CHART.BOTTOM, Math.max(CHART.TOP, yOf(s, h)));

/**
 * Width of bold 11 px text, px, measured on the wide side: the condensed face is not bundled and
 * iOS falls back to SF, about 0.6 em a letter.
 */
export function textWidth(text: string, font = LABEL_FONT): number {
  let em = 0;
  for (const ch of text) em += /[\s.,·]/.test(ch) ? 0.3 : /[–—]/.test(ch) ? 0.62 : 0.64;
  return Math.ceil(em * font);
}

export type LabelKind = 'mpbr' | 'peak' | 'far' | 'near' | 'fact' | 'ghost';

/** What a label is about: the point it belongs to and the marker drawn there. */
export interface LabelSpec {
  kind: LabelKind;
  text: string;
  /** The point, px. */
  x: number;
  y: number;
  /** Radius of the marker at the point, px; 0 for none. */
  r: number;
  /** Other points it may stand at, tried in turn after the first: a curve has no single point. */
  more?: readonly { x: number; y: number }[];
}

export interface PlacedLabel extends LabelSpec {
  box: Rect;
  /** Where the text starts and its baseline, px. */
  tx: number;
  ty: number;
}

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (a: Rect, b: Rect): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Above, below, right, left of the point, {@link GAP} px clear of its marker. */
function candidates(l: LabelSpec): Rect[] {
  const w = textWidth(l.text) + 2 * PAD;
  const off = l.r + GAP;
  return [l, ...(l.more ?? [])].flatMap(({ x, y }) => [
    { x: x - w / 2, y: y - off - LABEL_H, w, h: LABEL_H },
    { x: x - w / 2, y: y + off, w, h: LABEL_H },
    { x: x + off, y: y - LABEL_H / 2, w, h: LABEL_H },
    { x: x - off - w, y: y - LABEL_H / 2, w, h: LABEL_H },
  ]);
}

/** Liang–Barsky: does the segment touch the box. */
function crossesSegment(r: Rect, a: { x: number; y: number }, b: { x: number; y: number }) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const crossesCurve = (r: Rect, curve: readonly { x: number; y: number }[]): boolean =>
  curve.some((p, i) => i > 0 && crossesSegment(r, curve[i - 1], p));

/**
 * Spec 4в: each label tries above / below / right / left of its point, in the order given (the
 * priority), and takes the first spot clear of the labels already placed, of every marker and of
 * the edge. A spot clear of the curves too wins over one that is not; a label with no spot at all
 * is left out — its value is in the table and the hint.
 */
export function placeLabels(
  labels: readonly LabelSpec[],
  markers: readonly Rect[],
  curves: readonly (readonly { x: number; y: number }[])[],
  bounds: Rect,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  for (const label of labels) {
    const free = candidates(label).filter(
      (box) =>
        inside(box, bounds) &&
        !markers.some((m) => intersects(box, m)) &&
        !placed.some((p) => intersects(box, p.box)),
    );
    const box = free.find((b) => !curves.some((c) => crossesCurve(b, c))) ?? free[0];
    if (box) placed.push({ ...label, box, tx: box.x + PAD, ty: box.y + BASELINE });
  }
  return placed;
}

export interface ChartInput extends Scale {
  line: MpbrLine;
  /** The chosen zero, as it will be drawn when the transition ends. */
  points: readonly ChartPoint[];
  /** The zero now, dashed. */
  ghost: readonly ChartPoint[] | null;
  journal: readonly ChartFact[];
}

export interface Marker {
  x: number;
  y: number;
  r: number;
}

export interface FactMark {
  d: number;
  x: number;
  y: number;
  top: number;
  bottom: number;
}

export interface ChartLayout {
  crossings: Marker[];
  peak: Marker | null;
  exit: Marker | null;
  facts: FactMark[];
  labels: PlacedLabel[];
}

const CROSS_R = 3.5;
const HOT_R = 4.5;
/** The diamond is an 8 px square turned 45°. */
const FACT_R = 5.7;

const box = (m: Marker): Rect => ({ x: m.x - m.r, y: m.y - m.r, w: 2 * m.r, h: 2 * m.r });

/** A point of the dashed curve every this many px is a place for its label. */
const GHOST_STEP = 12;

/**
 * Points of the dashed curve inside the plot, farthest from the solid one first: there its label
 * cannot be taken for the other.
 */
function ghostAnchors(s: Scale, ghost: readonly ChartPoint[], points: readonly ChartPoint[]) {
  const out: { x: number; y: number; gap: number }[] = [];
  let last = -Infinity;
  ghost.forEach((g, i) => {
    const p = points[i];
    if (!p || p.d !== g.d || g.d < s.axis * 0.3 || g.d > s.axis * 0.95) return;
    const x = xOf(s, g.d);
    const y = yOf(s, g.h);
    if (y < CHART.TOP || y > CHART.BOTTOM || x - last < GHOST_STEP) return;
    last = x;
    out.push({ x, y, gap: Math.abs(y - yOf(s, p.h)) });
  });
  return out.sort((a, b) => b.gap - a.gap);
}

/** Every mark of the chart and its labels, laid out so that no two labels overlap. */
export function chartLayout(c: ChartInput): ChartLayout {
  const { line } = c;
  const x = (d: number) => xOf(c, d);
  const specs: LabelSpec[] = [];

  const crossings: Marker[] = [];
  const zeros: LabelSpec[] = [];
  for (const [kind, d] of [
    ['far', line.far],
    ['near', line.near],
  ] as const) {
    if (d == null || d > c.axis) continue;
    const m = { x: x(d), y: CHART.MID, r: CROSS_R };
    crossings.push(m);
    zeros.push({ kind, text: fmt(d, 0), ...m });
  }

  let exit: Marker | null = null;
  if (line.mpbr != null && line.mpbr <= c.axis && !line.above) {
    exit = { x: x(line.mpbr), y: yOf(c, -c.radius), r: HOT_R };
    specs.push({ kind: 'mpbr', text: `MPBR ${rangeText(line)}`, ...exit });
  }

  let peak: Marker | null = null;
  if (line.peak.d > 0) {
    peak = { x: x(line.peak.d), y: clampY(c, line.peak.h), r: HOT_R };
    const text = line.above
      ? `над зоной ${fmt(line.above[0], 0)}–${fmt(line.above[1], 0)}`
      : `${fmtSigned(line.peak.h / 10, 1)} на ${fmt(line.peak.d, 0)}`;
    specs.push({ kind: 'peak', text, ...peak });
  }
  specs.push(...zeros);

  const facts: FactMark[] = [];
  const whiskers: Rect[] = [];
  for (const f of c.journal) {
    if (f.d > c.axis) continue;
    const mark = {
      d: f.d,
      x: x(f.d),
      y: clampY(c, f.h),
      top: clampY(c, f.h + f.spread),
      bottom: clampY(c, f.h - f.spread),
    };
    facts.push(mark);
    whiskers.push({ x: mark.x - 1, y: mark.top, w: 2, h: mark.bottom - mark.top });
    if (Math.abs(f.h) > c.radius) {
      specs.push({ kind: 'fact', text: `журнал ${fmtSigned(f.h / 10, 1)}`, ...mark, r: FACT_R });
    }
  }

  const [ghost, ...more] = c.ghost ? ghostAnchors(c, c.ghost, c.points) : [];
  if (ghost) specs.push({ kind: 'ghost', text: 'сейчас', x: ghost.x, y: ghost.y, r: 0, more });

  const markers = [
    ...crossings.map(box),
    ...(peak ? [box(peak)] : []),
    ...(exit ? [box(exit)] : []),
    ...facts.map((f) => box({ ...f, r: FACT_R })),
    ...whiskers,
  ];
  const curve = (pts: readonly ChartPoint[]) => pts.map((p) => ({ x: x(p.d), y: yOf(c, p.h) }));
  const curves = [curve(c.points), ...(c.ghost ? [curve(c.ghost)] : [])];
  // Down to just over the distances on the axis.
  const bounds = { x: CHART.LEFT, y: 0, w: CHART.W - CHART.LEFT, h: CHART.BOTTOM + 5 };
  return { crossings, peak, exit, facts, labels: placeLabels(specs, markers, curves, bounds) };
}
