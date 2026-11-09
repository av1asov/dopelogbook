import type * as OpenCv from '@techstark/opencv-js';
import {
  PhotoMarks,
  PhotoScale,
  Point,
  Polarity,
  SheetSize,
  TargetReference,
  TargetRing,
  TargetTemplate,
  TemplateTarget,
} from '../ballistics/model';
import {
  applyHomography,
  Homography,
  homography,
  invertHomography,
  orderCorners,
  pxPerMmAt,
  rectangle,
  solve,
  tiltDegrees,
} from './homography';
import { CleanPicture, findHoles } from './holes';
import { assignToTargets, distance, fitLayout, FoundElement } from './measure';
import {
  assessQuality,
  ElementCheck,
  isOffScale,
  MEASURE_LIMITS,
  printScaleOf,
  Quality,
  QualityLimits,
  TEMPLATE_LIMITS,
} from './quality';

type Cv = typeof OpenCv;
type Mat = OpenCv.Mat;
type Layout = Pick<TargetTemplate, 'sheet' | 'targets' | 'artSize'>;

export interface DetectImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MeasureRequest {
  kind: 'measure';
  image: DetectImage;
  template: Layout | null;
  /** A plane set by hand replaces the search for one. */
  manual: Pick<PhotoMarks, 'scale' | 'homography'> | null;
  holeMm: number;
  /** Shots per target. */
  shots: number | null;
  /** The template's picture of the sheet before any shots. */
  clean?: CleanSheet | null;
}

/** Rectified like `FlatImage`: a millimetre of the template is at ((x − x0)·k, (y − y0)·k). */
export interface CleanSheet {
  image: DetectImage;
  x0: number;
  y0: number;
  k: number;
}

export interface SurveyRequest {
  kind: 'survey';
  image: DetectImage;
  sheet: SheetSize;
}

export interface WarpRequest {
  kind: 'warp';
  image: DetectImage;
  homography: number[];
  sheet?: SheetSize;
}

export type DetectRequest = MeasureRequest | SurveyRequest | WarpRequest;

/** The rectified picture; a millimetre (x, y) is at pixel ((x − x0)·k, (y − y0)·k). */
export interface FlatImage extends DetectImage {
  x0: number;
  y0: number;
  k: number;
}

export interface DetectedHole extends Point {
  /** There are more holes than shots, and this is one of the least convincing. */
  doubtful: boolean;
}

export interface DetectedTarget {
  n: number;
  aim: Point | null;
  holes: DetectedHole[];
}

export interface FoundPlane {
  scale: PhotoScale;
  homography?: number[];
}

export interface MeasureResult {
  plane: FoundPlane | null;
  flat: FlatImage | null;
  targets: DetectedTarget[] | null;
  quality: Quality | null;
  /** Printed elements on the rectified sheet, for telling which template this is. */
  elements: FoundElement[];
}

export interface SurveyResult {
  plane: FoundPlane | null;
  flat: FlatImage | null;
  quality: Quality | null;
  sheet: SheetSize | null;
  targets: TemplateTarget[] | null;
}

export interface WarpResult {
  flat: FlatImage;
}

export type DetectResult = MeasureResult | SurveyResult | WarpResult;

/** Collects OpenCV objects, which live outside the JS heap and must be freed by hand. */
class Scope {
  private readonly owned: { delete(): void }[] = [];

  own<T extends { delete(): void }>(item: T): T {
    this.owned.push(item);
    return item;
  }

  free(): void {
    for (const item of this.owned) item.delete();
  }
}

const CARD = { long: 85.6, short: 54 };
/** The edge map is thickened to close gaps, which pushes the outline out by this much. */
const CARD_EDGE_PX = 2.5;
const FLAT_PX_PER_MM = 5;
const FLAT_MARGIN = 6;
const FLAT_MAX_PX = 2600;
const FLAT_REACH_MM = 400;
const FLAT_BACKGROUND = 60;
const MIN_HOLE_PX = 6;
/** Closing that joins the pieces of a printed disc, as shares of the picture; smallest first. */
const DISC_CLOSING = [0.012, 0.016, 0.02, 0.024];
const MIN_DISC_SHARE = 0.1;
const DISC_FIT = 0.12;
const DISC_SAME = 0.2;
const LAYOUT_FIT = 0.08;
/** How far from its place in the template an element may lie, mm. */
const ELEMENT_REACH = 18;
const MIN_ELEMENT_MM = 8;
const SHEET_INSET = 3;
/** How far the print can be from the template and still be recognised. */
const RING_SCALE = { from: 0.85, to: 1.15, step: 0.0025 };
const RING_ANGLES = 72;
const RING_MIN_COVER = 0.5;
/** Each ring must be centred on the common centre to within this, mm. */
const RING_CENTRE_MM = 1;

const odd = (n: number): number => Math.max(3, Math.round(n) | 1);
const halfMm = (mm: number): number => Math.round(mm * 2) / 2;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Half of the typical brightness: printed black falls below it even on shaded paper. */
function darkLevel(gray: Mat): number {
  const histogram = new Array<number>(256).fill(0);
  const pixels = gray.data as Uint8Array;
  for (const value of pixels) histogram[value]++;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += histogram[level];
    if (seen * 2 >= pixels.length) return level / 2;
  }
  return 127;
}

function pointsOf(contour: Mat): Point[] {
  const data = contour.data32S as Int32Array;
  const points: Point[] = [];
  for (let i = 0; i < contour.rows; i++) points.push({ x: data[i * 2], y: data[i * 2 + 1] });
  return points;
}

function touchesBorder(cv: Cv, contour: Mat, gray: Mat): boolean {
  const box = cv.boundingRect(contour);
  return (
    box.x <= 1 ||
    box.y <= 1 ||
    box.x + box.width >= gray.cols - 1 ||
    box.y + box.height >= gray.rows - 1
  );
}

interface Components {
  contours: OpenCv.MatVector;
  /** Outer boundaries only. */
  outer: number[];
}

/**
 * Every white component, however deep. With only the outermost contours, a dark table around
 * the sheet would form a ring that hides everything printed inside it.
 */
function components(cv: Cv, bin: Mat, scope: Scope): Components {
  const contours = scope.own(new cv.MatVector());
  const hierarchy = scope.own(new cv.Mat());
  cv.findContours(bin, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
  const links = hierarchy.data32S as Int32Array;
  const outer: number[] = [];
  for (let i = 0; i < contours.size(); i++) if (links[i * 4 + 3] < 0) outer.push(i);
  return { contours, outer };
}

/** Large dark shapes with thin printed lines removed. */
function darkComponents(cv: Cv, gray: Mat, scope: Scope): Components {
  const bin = scope.own(new cv.Mat());
  cv.threshold(gray, bin, darkLevel(gray), 255, cv.THRESH_BINARY_INV);
  const size = odd(Math.min(gray.cols, gray.rows) * 0.006);
  const kernel = scope.own(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(size, size)));
  cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel);
  return components(cv, bin, scope);
}

/** Large light shapes; a printed field around them has to be told apart by looking at it. */
function lightComponents(cv: Cv, gray: Mat, scope: Scope): Components {
  const bin = scope.own(new cv.Mat());
  cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
  const size = odd(Math.min(gray.cols, gray.rows) * 0.006);
  const kernel = scope.own(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(size, size)));
  cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel);
  return components(cv, bin, scope);
}

interface Line {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

const lineThrough = (a: Point, b: Point): Line => {
  const length = distance(a, b) || 1;
  return { x: a.x, y: a.y, dx: (b.x - a.x) / length, dy: (b.y - a.y) / length };
};

const offLine = (line: Line, p: Point): number =>
  Math.abs((p.x - line.x) * line.dy - (p.y - line.y) * line.dx);

/** Total least squares: the line through the middle along the main direction of the points. */
function fitLine(points: readonly Point[]): Line {
  const { x, y } = centreOf(points);
  let [xx, xy, yy] = [0, 0, 0];
  for (const p of points) {
    xx += (p.x - x) * (p.x - x);
    xy += (p.x - x) * (p.y - y);
    yy += (p.y - y) * (p.y - y);
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  return { x, y, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function meet(a: Line, b: Line): Point {
  const det = a.dx * b.dy - a.dy * b.dx;
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / det;
  return { x: a.x + a.dx * t, y: a.y + a.dy * t };
}

/**
 * Corners as the meeting points of lines fitted to the sides. A hole at a corner, a rounded
 * bank card or a folded sheet corner all leave the straight part of the sides intact.
 */
function refineCorners(outline: readonly Point[], corners: readonly Point[]): Point[] {
  const lines = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const length = distance(a, b);
    let line = lineThrough(a, b);
    for (const tolerance of [length * 0.06, length * 0.02 + 1.5, 1.5]) {
      const near = outline.filter((p) => {
        const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length);
        return along > 0.12 && along < 0.88 && offLine(line, p) <= tolerance;
      });
      if (near.length < 8) break;
      line = fitLine(near);
    }
    return line;
  });
  return lines.map((line, i) => meet(lines[(i + lines.length - 1) % lines.length], line));
}

/** Four corners of a quadrilateral outline, or null if it has another shape. */
function quadOf(cv: Cv, contour: Mat, tolerance: number, scope: Scope) {
  // The hull keeps the corners even when a hole bites into the edge.
  const hull = scope.own(new cv.Mat());
  cv.convexHull(contour, hull, false, true);
  const approx = scope.own(new cv.Mat());
  cv.approxPolyDP(hull, approx, tolerance * cv.arcLength(hull, true), true);
  if (approx.rows !== 4) return null;
  const points = orderCorners(refineCorners(pointsOf(contour), orderCorners(pointsOf(approx))));
  return { points, hullArea: cv.contourArea(hull) };
}

function sidesOf(points: readonly Point[]): number[] {
  return points.map((p, i) => distance(p, points[(i + 1) % points.length]));
}

function cornerError(points: readonly Point[]): number {
  return Math.max(
    ...points.map((p, i) => {
      const a = points[(i + points.length - 1) % points.length];
      const b = points[(i + 1) % points.length];
      const cosine =
        ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / (distance(a, p) * distance(b, p));
      return Math.abs((Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI - 90);
    }),
  );
}

/** The sheet: the largest bright four-sided shape with all its corners in the frame. */
function findSheetCorners(cv: Cv, gray: Mat, scope: Scope): Point[] | null {
  const bin = scope.own(new cv.Mat());
  cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
  // A printed grid would otherwise cut the sheet into separate cells.
  const size = odd(Math.min(gray.cols, gray.rows) * 0.015);
  const kernel = scope.own(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(size, size)));
  cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel);
  const { contours, outer } = components(cv, bin, scope);
  const imageArea = gray.cols * gray.rows;
  let best: { area: number; points: Point[] } | null = null;
  for (const i of outer) {
    const contour = scope.own(contours.get(i));
    const area = cv.contourArea(contour);
    if (area < imageArea * 0.15 || touchesBorder(cv, contour, gray)) continue;
    const quad = quadOf(cv, contour, 0.02, scope);
    if (quad && (!best || area > best.area)) best = { area, points: quad.points };
  }
  return best?.points ?? null;
}

interface Plane extends FoundPlane {
  sheet?: SheetSize;
  /** Quarter turns of the template worth trying. */
  turns: number[];
  /** Printed elements already located on the photo; a plane from them needs no second look. */
  aim?: Point | null;
  /** The homography already allows for a print that is not at 100 %. */
  printScale?: number;
}

function sheetPlane(
  corners: readonly Point[],
  sheet: SheetSize,
  turnable: boolean,
  anyTurn = false,
): Plane | null {
  const [tl, tr, br, bl] = corners;
  const across = (distance(tl, tr) + distance(bl, br)) / 2;
  const down = (distance(tl, bl) + distance(tr, br)) / 2;
  const swapped = across > down !== sheet.w > sheet.h;
  const { w, h } = swapped ? { w: sheet.h, h: sheet.w } : sheet;
  // Perspective changes the proportions, but not by this much on a real sheet.
  const seen = across / down;
  const expected = w / h;
  if (seen / expected > 1.4 || expected / seen > 1.4) return null;
  const matrix = homography(corners, rectangle(w, h));
  if (!matrix) return null;
  return {
    scale: { source: 'sheet', p1: tl, p2: tr, mm: w, sheet: { w, h } },
    homography: [...matrix],
    sheet: { w, h },
    turns: !turnable
      ? [0]
      : [...(swapped ? [1, 3] : [0, 2]), ...(anyTurn ? (swapped ? [0, 2] : [1, 3]) : [])],
  };
}

interface FoundSquare {
  area: number;
  points: [Point, Point, Point, Point];
}

function findSquares(cv: Cv, gray: Mat, scope: Scope): FoundSquare[] {
  const { contours, outer } = darkComponents(cv, gray, scope);
  const imageArea = gray.cols * gray.rows;
  const squares: FoundSquare[] = [];
  for (const i of outer) {
    const contour = scope.own(contours.get(i));
    const area = cv.contourArea(contour);
    if (area < imageArea * 0.0003 || area > imageArea * 0.5) continue;
    if (touchesBorder(cv, contour, gray)) continue;
    const quad = quadOf(cv, contour, 0.04, scope);
    if (!quad || area / quad.hullArea < 0.85) continue;
    const sides = sidesOf(quad.points);
    if (Math.max(...sides) / Math.min(...sides) > 1.7) continue;
    squares.push({ area, points: quad.points });
  }
  return squares.sort((a, b) => b.area - a.area);
}

function squareCorners({ x, y }: Point, size: number): Point[] {
  const half = size / 2;
  return [
    { x: x - half, y: y - half },
    { x: x + half, y: y - half },
    { x: x + half, y: y + half },
    { x: x - half, y: y + half },
  ];
}

/** With more than four matched points a robust fit shrugs off a badly found corner. */
function fitHomography(cv: Cv, from: Point[], to: Point[], scope: Scope): Homography | null {
  if (from.length === 4) return homography(from, to);
  const flat = (points: Point[]) => points.flatMap((p) => [p.x, p.y]);
  const source = scope.own(cv.matFromArray(from.length, 1, cv.CV_32FC2, flat(from)));
  const target = scope.own(cv.matFromArray(to.length, 1, cv.CV_32FC2, flat(to)));
  const fitted = scope.own(cv.findHomography(source, target, cv.RANSAC, 3));
  if (fitted.rows !== 3) return null;
  return [...(fitted.data64F as Float64Array)];
}

const readingOrder = <T extends Point>(items: readonly T[], tolerance: number): T[] =>
  [...items].sort((a, b) => (Math.abs(a.y - b.y) < tolerance ? a.x - b.x : a.y - b.y));

const centreOf = (points: readonly Point[]): Point => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

/** A plane from the black squares of the template, in the coordinates of its sheet. */
function squaresPlane(cv: Cv, gray: Mat, layout: Layout, scope: Scope): Plane | null {
  const size = (layout.targets[0].reference as { size: number }).size;
  const found = findSquares(cv, gray, scope);
  if (!found.length) return null;
  const alike = found.filter((s) => s.area > found[0].area * 0.6);
  if (alike.length < layout.targets.length) return null;
  const chosen = alike.slice(0, layout.targets.length).map((s) => ({
    ...centreOf(s.points),
    points: s.points,
  }));
  const side = Math.sqrt(chosen.length ? found[0].area : 1);
  const ordered = readingOrder(chosen, side);
  const places = readingOrder(layout.targets, size);
  const from = ordered.flatMap((s) => s.points);
  const to = places.flatMap((t) => squareCorners(t, size));
  const matrix = fitHomography(cv, from, to, scope);
  if (!matrix) return null;
  return {
    scale: { source: 'element', p1: from[0], p2: from[1], mm: size },
    homography: [...matrix],
    turns: [0],
  };
}

function findCircle(cv: Cv, gray: Mat, scope: Scope): { centre: Point; radius: number } | null {
  const { contours, outer } = darkComponents(cv, gray, scope);
  const imageArea = gray.cols * gray.rows;
  let best: { area: number; centre: Point; radius: number } | null = null;
  for (const i of outer) {
    const contour = scope.own(contours.get(i));
    const area = cv.contourArea(contour);
    if (area < imageArea * 0.0003 || area > imageArea * 0.5) continue;
    if (touchesBorder(cv, contour, gray)) continue;
    const hull = scope.own(new cv.Mat());
    cv.convexHull(contour, hull, false, true);
    const perimeter = cv.arcLength(hull, true);
    if ((4 * Math.PI * cv.contourArea(hull)) / (perimeter * perimeter) < 0.8) continue;
    const circle = cv.minEnclosingCircle(contour);
    if (!best || area > best.area) best = { area, centre: circle.center, radius: circle.radius };
  }
  return best;
}

function circlePlane(centre: Point, radius: number, mm: number, aim: TemplateTarget['aim']): Plane {
  const pxPerMm = (radius * 2) / mm;
  return {
    scale: {
      source: 'element',
      p1: { x: centre.x - radius, y: centre.y },
      p2: { x: centre.x + radius, y: centre.y },
      mm,
    },
    turns: [0],
    aim: aim ? { x: centre.x + aim.right * pxPerMm, y: centre.y - aim.up * pxPerMm } : null,
  };
}

interface GridLine {
  rho: number;
  theta: number;
}

/** Edges come in pairs and lines repeat, so nearby ones become one. */
function mergeLines(lines: GridLine[], tolerance: number): GridLine[] {
  const merged: GridLine[][] = [];
  for (const line of [...lines].sort((a, b) => a.rho - b.rho)) {
    const last = merged.at(-1);
    if (last && line.rho - last[last.length - 1].rho < tolerance) last.push(line);
    else merged.push([line]);
  }
  return merged.map((group) => ({
    rho: group.reduce((sum, l) => sum + l.rho, 0) / group.length,
    theta: group.reduce((sum, l) => sum + l.theta, 0) / group.length,
  }));
}

function cross(a: GridLine, b: GridLine): Point {
  const [ca, sa, cb, sb] = [
    Math.cos(a.theta),
    Math.sin(a.theta),
    Math.cos(b.theta),
    Math.sin(b.theta),
  ];
  const det = ca * sb - sa * cb;
  return { x: (a.rho * sb - b.rho * sa) / det, y: (b.rho * ca - a.rho * cb) / det };
}

const gapsOf = (lines: readonly GridLine[]): number[] =>
  lines.slice(1).map((line, i) => line.rho - lines[i].rho);

function cellsBetween(lines: readonly GridLine[]): number {
  return Math.round((lines[lines.length - 1].rho - lines[0].rho) / median(gapsOf(lines)));
}

function gridLines(cv: Cv, gray: Mat, scope: Scope): { columns: GridLine[]; rows: GridLine[] } {
  const side = Math.min(gray.cols, gray.rows);
  const edges = scope.own(new cv.Mat());
  cv.Canny(gray, edges, 50, 150);
  const found = scope.own(new cv.Mat());
  cv.HoughLines(edges, found, 1, Math.PI / 180, Math.round(side * 0.3));
  const vertical: GridLine[] = [];
  const horizontal: GridLine[] = [];
  const data = found.data32F as Float32Array;
  for (let i = 0; i < Math.min(found.rows, 400); i++) {
    let [rho, theta] = [data[i * 2], data[i * 2 + 1]];
    if (theta > (3 * Math.PI) / 4) [rho, theta] = [-rho, theta - Math.PI];
    if (Math.abs(theta) < Math.PI / 6) vertical.push({ rho, theta });
    else if (Math.abs(theta - Math.PI / 2) < Math.PI / 6) horizontal.push({ rho, theta });
  }
  return {
    columns: mergeLines(vertical, side * 0.012),
    rows: mergeLines(horizontal, side * 0.012),
  };
}

function gridPlane(cv: Cv, gray: Mat, step: number, scope: Scope): Plane | null {
  const { columns, rows } = gridLines(cv, gray, scope);
  if (columns.length < 3 || rows.length < 3) return null;
  const [left, right, top, bottom] = [columns[0], columns.at(-1)!, rows[0], rows.at(-1)!];
  const corners = [cross(left, top), cross(right, top), cross(right, bottom), cross(left, bottom)];
  const [w, h] = [cellsBetween(columns) * step, cellsBetween(rows) * step];
  const matrix = homography(corners, rectangle(w, h));
  if (!matrix) return null;
  return {
    scale: { source: 'element', p1: corners[0], p2: corners[1], mm: w },
    homography: [...matrix],
    turns: [0],
  };
}

/** Radii around `centre` where the edge map forms a ring. */
function ringRadii(edges: Mat, centre: Point, maxRadius: number): number[] {
  const hits: number[] = [];
  const pixels = edges.data as Uint8Array;
  for (let r = 8; r < maxRadius; r++) {
    const samples = Math.round(2 * Math.PI * r);
    let on = 0;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * 2 * Math.PI;
      const x = Math.round(centre.x + Math.cos(a) * r);
      const y = Math.round(centre.y + Math.sin(a) * r);
      if (x < 1 || y < 1 || x >= edges.cols - 1 || y >= edges.rows - 1) continue;
      // Three pixels across: a ring is never exactly on one radius.
      const row = y * edges.cols;
      if (pixels[row + x] || pixels[row + x - 1] || pixels[row + x + 1]) on++;
    }
    hits.push(on / samples);
  }
  const peaks: number[] = [];
  hits.forEach((value, i) => {
    if (value < 0.45 || value < (hits[i - 1] ?? 0) || value < (hits[i + 1] ?? 0)) return;
    const radius = i + 8;
    if (radius - (peaks.at(-1) ?? -99) > 3) peaks.push(radius);
  });
  return peaks;
}

/** The known diameter of the outermost ring that fits the most measured radii. */
function matchRings(radii: readonly number[], diameters: readonly number[]) {
  let best: { inliers: number; radius: number; mm: number } | null = null;
  for (const radius of radii) {
    for (const mm of diameters) {
      const pxPerMm = radius / (mm / 2);
      const fits = radii.filter((r) =>
        diameters.some((d) => Math.abs(r - (d / 2) * pxPerMm) < Math.max(2, r * 0.025)),
      );
      const outer = Math.max(...fits);
      if (!best || fits.length > best.inliers) {
        best = { inliers: fits.length, radius: outer, mm: (outer / pxPerMm) * 2 };
      }
    }
  }
  return best;
}

function circleCentres(
  cv: Cv,
  gray: Mat,
  minDist: number,
  minR: number,
  maxR: number,
  scope: Scope,
) {
  const circles = scope.own(new cv.Mat());
  cv.HoughCircles(
    gray,
    circles,
    cv.HOUGH_GRADIENT,
    1,
    minDist,
    120,
    60,
    Math.round(minR),
    Math.round(maxR),
  );
  const data = circles.data32F as Float32Array;
  // One row with a column per circle, unlike the lines of HoughLines.
  return Array.from({ length: circles.cols }, (_, i) => ({ x: data[i * 3], y: data[i * 3 + 1] }));
}

function ringsPlane(
  cv: Cv,
  gray: Mat,
  diameters: readonly number[],
  aim: TemplateTarget['aim'],
  scope: Scope,
): Plane | null {
  const side = Math.min(gray.cols, gray.rows);
  const [centre] = circleCentres(cv, gray, side / 4, side * 0.03, side * 0.5, scope);
  if (!centre) return null;
  const edges = scope.own(new cv.Mat());
  cv.Canny(gray, edges, 50, 150);
  const match = matchRings(ringRadii(edges, centre, side * 0.6), diameters);
  if (!match || match.inliers < Math.min(2, diameters.length)) return null;
  const nearest = diameters.reduce((a, b) =>
    Math.abs(b - match.mm) < Math.abs(a - match.mm) ? b : a,
  );
  return circlePlane(centre, match.radius, nearest, aim);
}

/** Big dark ellipses of one size: printed discs, however they are cut up by white lines. */
function darkDiscs(cv: Cv, gray: Mat, count: number, scope: Scope): Point[] | null {
  const dark = scope.own(new cv.Mat());
  cv.threshold(gray, dark, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  const side = Math.min(gray.cols, gray.rows);
  for (const share of DISC_CLOSING) {
    const size = odd(side * share);
    const kernel = scope.own(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(size, size)));
    const closed = scope.own(new cv.Mat());
    cv.morphologyEx(dark, closed, cv.MORPH_CLOSE, kernel);
    const { contours, outer } = components(cv, closed, scope);
    const discs: { centre: Point; area: number }[] = [];
    for (const i of outer) {
      const contour = scope.own(contours.get(i));
      const area = cv.contourArea(contour);
      if (area < (side * MIN_DISC_SHARE) ** 2 || contour.rows < 5) continue;
      const fit = cv.fitEllipse(contour);
      const full = (Math.PI * fit.size.width * fit.size.height) / 4;
      if (Math.abs(area / full - 1) > DISC_FIT) continue;
      discs.push({ centre: { x: fit.center.x, y: fit.center.y }, area });
    }
    if (discs.length !== count) continue;
    const middle = median(discs.map((d) => d.area));
    if (discs.every((d) => Math.abs(d.area / middle - 1) < DISC_SAME)) {
      return discs.map((d) => d.centre);
    }
  }
  return null;
}

/** The corner of a layout each corner of the picture stands for, and how well the rest fits. */
function layoutPlane(found: readonly Point[], layout: Layout, scope: Scope, cv: Cv): Plane | null {
  const places = layout.targets.map(({ x, y }) => ({ x, y }));
  const from = orderCorners(found);
  const to = orderCorners(places);
  const matrix = homography(from, to);
  if (!matrix) return null;
  const onPlane = found.map((p) => applyHomography(matrix, p));
  const tolerance = Math.max(...places.map((p) => distance(p, places[0]))) * LAYOUT_FIT;
  if (places.some((p) => !onPlane.some((q) => distance(p, q) < tolerance))) return null;
  const refined = found.length > 4 ? fitHomography(cv, [...found], places, scope) : matrix;
  if (!refined) return null;
  return {
    scale: { source: 'targets', p1: from[0], p2: from[1], mm: distance(to[0], to[1]) },
    homography: [...refined],
    turns: [0],
  };
}

/** The sheet is out of the shot, but the targets on it tell the perspective themselves. */
function targetsPlane(cv: Cv, gray: Mat, layout: Layout, scope: Scope): Plane | null {
  const reference = layout.targets[0].reference;
  if (reference.kind !== 'rings' && reference.kind !== 'circle') return null;
  const found = darkDiscs(cv, gray, layout.targets.length, scope);
  return found && layoutPlane(found, layout, scope, cv);
}

function elementPlane(cv: Cv, gray: Mat, layout: Layout, scope: Scope): Plane | null {
  const [first] = layout.targets;
  if (!first) return null;
  if (first.reference.kind === 'square') return squaresPlane(cv, gray, layout, scope);
  if (layout.targets.length >= 4) return targetsPlane(cv, gray, layout, scope);
  if (layout.targets.length > 1) return null;
  const { reference, aim } = first;
  switch (reference.kind) {
    case 'circle': {
      const circle = findCircle(cv, gray, scope);
      return circle && circlePlane(circle.centre, circle.radius, reference.size, aim);
    }
    case 'grid':
      return gridPlane(cv, gray, reference.step, scope);
    case 'rings':
      return ringsPlane(cv, gray, reference.diameters, aim, scope);
  }
}

function insetCorners(corners: readonly Point[], px: number): Point[] {
  const centre = centreOf(corners);
  return corners.map((p) => {
    const reach = distance(p, centre);
    const share = (reach - px * Math.SQRT2) / reach;
    return { x: centre.x + (p.x - centre.x) * share, y: centre.y + (p.y - centre.y) * share };
  });
}

/** A bank card: a rectangle with the proportions 1.586, light or dark against the paper. */
function cardPlane(cv: Cv, gray: Mat, scope: Scope): Plane | null {
  const edges = scope.own(new cv.Mat());
  cv.Canny(gray, edges, 30, 100);
  const kernel = scope.own(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
  cv.dilate(edges, edges, kernel);
  const { contours, outer } = components(cv, edges, scope);
  const imageArea = gray.cols * gray.rows;
  let best: { area: number; points: Point[] } | null = null;
  for (const i of outer) {
    const contour = scope.own(contours.get(i));
    const area = cv.contourArea(contour);
    if (area < imageArea * 0.005 || area > imageArea * 0.4) continue;
    if (touchesBorder(cv, contour, gray)) continue;
    const quad = quadOf(cv, contour, 0.03, scope);
    if (!quad) continue;
    const sides = sidesOf(quad.points);
    const across = (sides[0] + sides[2]) / 2;
    const down = (sides[1] + sides[3]) / 2;
    const ratio = Math.max(across, down) / Math.min(across, down);
    if (ratio < 1.3 || ratio > 1.9) continue;
    if (!best || area > best.area) best = { area, points: quad.points };
  }
  if (!best) return null;
  const corners = insetCorners(best.points, CARD_EDGE_PX);
  const [tl, tr, , bl] = corners;
  const wide = distance(tl, tr) >= distance(tl, bl);
  const [w, h] = wide ? [CARD.long, CARD.short] : [CARD.short, CARD.long];
  const matrix = homography(corners, rectangle(w, h));
  if (!matrix) return null;
  return { scale: { source: 'card', p1: tl, p2: tr, mm: w }, homography: [...matrix], turns: [0] };
}

/** A hole can pass for a printed element, but then real holes would be a pixel wide. */
function plausible(scale: PhotoScale, holeMm: number): boolean {
  return (holeMm * distance(scale.p1, scale.p2)) / scale.mm >= MIN_HOLE_PX;
}

function findPlane(cv: Cv, gray: Mat, request: MeasureRequest, scope: Scope): Plane | null {
  const { template, holeMm } = request;
  if (template) {
    const corners = findSheetCorners(cv, gray, scope);
    // A drawing smaller than the sheet, or a ring target, can be printed turned on the sheet.
    const anyTurn = !!template.artSize || template.targets[0]?.reference.kind === 'rings';
    const onSheet = corners && sheetPlane(corners, template.sheet, true, anyTurn);
    if (onSheet) return onSheet;
    const element = elementPlane(cv, gray, template, scope);
    if (element && plausible(element.scale, holeMm)) return element;
  }
  const card = cardPlane(cv, gray, scope);
  return card && plausible(card.scale, holeMm) ? card : null;
}

interface PlaneView {
  x0: number;
  y0: number;
  k: number;
  width: number;
  height: number;
}

function planeView(
  matrix: Homography,
  image: { width: number; height: number },
  sheet?: SheetSize,
): PlaneView {
  let box: { x0: number; y0: number; x1: number; y1: number };
  if (sheet) {
    box = {
      x0: -FLAT_MARGIN,
      y0: -FLAT_MARGIN,
      x1: sheet.w + FLAT_MARGIN,
      y1: sheet.h + FLAT_MARGIN,
    };
  } else {
    const middle = applyHomography(matrix, { x: image.width / 2, y: image.height / 2 });
    const seen = rectangle(image.width, image.height).map((p) => applyHomography(matrix, p));
    const clamp = (value: number, centre: number) =>
      Math.max(centre - FLAT_REACH_MM, Math.min(centre + FLAT_REACH_MM, value));
    const xs = seen.map((p) => clamp(p.x, middle.x));
    const ys = seen.map((p) => clamp(p.y, middle.y));
    box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  const longest = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const k = Math.min(FLAT_PX_PER_MM, FLAT_MAX_PX / longest);
  return {
    x0: box.x0,
    y0: box.y0,
    k,
    width: Math.round((box.x1 - box.x0) * k),
    height: Math.round((box.y1 - box.y0) * k),
  };
}

function warp(cv: Cv, rgba: Mat, matrix: Homography, view: PlaneView, scope: Scope): Mat {
  const { k, x0, y0 } = view;
  const m = matrix;
  const toFlat = [
    k * m[0] - k * x0 * m[6],
    k * m[1] - k * x0 * m[7],
    k * m[2] - k * x0 * m[8],
    k * m[3] - k * y0 * m[6],
    k * m[4] - k * y0 * m[7],
    k * m[5] - k * y0 * m[8],
    m[6],
    m[7],
    m[8],
  ];
  const transform = scope.own(cv.matFromArray(3, 3, cv.CV_64F, toFlat));
  const flat = scope.own(new cv.Mat());
  const edge = FLAT_BACKGROUND;
  cv.warpPerspective(
    rgba,
    flat,
    transform,
    new cv.Size(view.width, view.height),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(edge, edge, edge, 255),
  );
  return flat;
}

const flatImage = (flat: Mat, view: PlaneView): FlatImage => ({
  data: new Uint8ClampedArray(flat.data as Uint8Array),
  width: flat.cols,
  height: flat.rows,
  x0: view.x0,
  y0: view.y0,
  k: view.k,
});

function toGray(cv: Cv, rgba: Mat, scope: Scope): Mat {
  const gray = scope.own(new cv.Mat());
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  const smooth = scope.own(new cv.Mat());
  cv.GaussianBlur(gray, smooth, new cv.Size(5, 5), 0);
  return smooth;
}

interface PlaneElement extends FoundElement {
  angleError?: number;
  /** Rings only: the printed size against the template. */
  ringScale?: number;
}

/** The typical brightness on a circle around a point. */
function levelAround(gray: Mat, { x, y }: Point, radius: number): number {
  const pixels = gray.data as Uint8Array;
  const levels: number[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    const px = Math.round(x + Math.cos(a) * radius);
    const py = Math.round(y + Math.sin(a) * radius);
    if (px >= 0 && py >= 0 && px < gray.cols && py < gray.rows)
      levels.push(pixels[py * gray.cols + px]);
  }
  return levels.length ? median(levels) : 0;
}

/** Solid squares and circles of one polarity on the rectified plane, in mm. */
function solidElements(
  cv: Cv,
  gray: Mat,
  { contours, outer }: Components,
  polarity: Polarity,
  view: PlaneView,
  scope: Scope,
): PlaneElement[] {
  const elements: PlaneElement[] = [];
  const toMm = ({ x, y }: Point): Point => ({ x: x / view.k + view.x0, y: y / view.k + view.y0 });
  // The paper itself is the largest light shape there is.
  const largest = (Math.min(gray.cols, gray.rows) / view.k) * 0.6;
  for (const i of outer) {
    const contour = scope.own(contours.get(i));
    const area = cv.contourArea(contour);
    if (touchesBorder(cv, contour, gray)) continue;
    const size = Math.sqrt(area) / view.k;
    if (size < MIN_ELEMENT_MM * 0.8 || (polarity === 'light' && size > largest)) continue;
    const quad = quadOf(cv, contour, 0.04, scope);
    let found: PlaneElement | null = null;
    let reach = 0;
    if (quad && area / quad.hullArea > 0.85) {
      const sides = sidesOf(quad.points);
      if (Math.max(...sides) / Math.min(...sides) < 1.25) {
        const side = sides.reduce((sum, s) => sum + s, 0) / 4;
        reach = side;
        found = {
          ...toMm(centreOf(quad.points)),
          kind: 'square',
          // A contour runs through pixel centres, one pixel inside the true outline.
          size: (side + 1) / view.k,
          angleError: cornerError(quad.points),
          polarity,
        };
      }
    }
    if (!found) {
      const circle = cv.minEnclosingCircle(contour);
      if (area / (Math.PI * circle.radius * circle.radius) <= 0.8) continue;
      reach = circle.radius * 2;
      found = { ...toMm(circle.center), kind: 'circle', size: reach / view.k, polarity };
    }
    if (polarity === 'light') {
      // A cell of a thin grid is light too, but beyond its lines there is only more paper.
      const centre = { x: (found.x - view.x0) * view.k, y: (found.y - view.y0) * view.k };
      // Past the edge of the sheet is the dark surround of the picture, not a printed field.
      const margin = reach * 0.75 + FLAT_MARGIN * view.k;
      const inFrame =
        centre.x > margin &&
        centre.y > margin &&
        centre.x < gray.cols - margin &&
        centre.y < gray.rows - margin;
      if (
        !inFrame ||
        levelAround(gray, centre, reach * 0.75) > levelAround(gray, centre, reach * 0.25) * 0.75
      ) {
        continue;
      }
    }
    elements.push(found);
  }
  return elements;
}

/** Solid elements of both polarities, dark ones first. */
function planeElements(cv: Cv, gray: Mat, view: PlaneView, scope: Scope): PlaneElement[] {
  return [
    ...solidElements(cv, gray, darkComponents(cv, gray, scope), 'dark', view, scope),
    ...solidElements(cv, gray, lightComponents(cv, gray, scope), 'light', view, scope),
  ];
}

function edgePoints(edges: Mat): Point[] {
  const pixels = edges.data as Uint8Array;
  const points: Point[] = [];
  for (let y = 0; y < edges.rows; y++) {
    for (let x = 0; x < edges.cols; x++) if (pixels[y * edges.cols + x]) points.push({ x, y });
  }
  return points;
}

/** For each radius, the share of directions in which an edge lies at that radius. */
function ringCover(
  points: readonly Point[],
  centre: Point,
  maxRadius: number,
  tolerance: number,
): Float64Array {
  const marks = new Uint8Array((maxRadius + 1) * RING_ANGLES);
  for (const p of points) {
    const [dx, dy] = [p.x - centre.x, p.y - centre.y];
    const gap = Math.hypot(dx, dy);
    if (gap > maxRadius + tolerance) continue;
    const angle = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * RING_ANGLES);
    const from = Math.max(0, Math.ceil(gap - tolerance));
    const to = Math.min(maxRadius, Math.floor(gap + tolerance));
    for (let r = from; r <= to; r++) marks[r * RING_ANGLES + (angle % RING_ANGLES)] = 1;
  }
  const cover = new Float64Array(maxRadius + 1);
  for (let r = 0; r <= maxRadius; r++) {
    let on = 0;
    for (let a = 0; a < RING_ANGLES; a++) on += marks[r * RING_ANGLES + a];
    cover[r] = on / RING_ANGLES;
  }
  return cover;
}

/** The print scale at which every ring has edges under it, or null if there is none. */
function bestRingScale(cover: Float64Array, radii: readonly number[]) {
  let best: { scale: number; score: number } | null = null;
  for (let scale = RING_SCALE.from; scale <= RING_SCALE.to; scale += RING_SCALE.step) {
    const covers = radii.map((r) => cover[Math.round(r * scale)] ?? 0);
    if (Math.min(...covers) < RING_MIN_COVER) continue;
    const score = covers.reduce((sum, c) => sum + c, 0) / covers.length;
    if (!best || score > best.score) best = { scale, score };
  }
  return best;
}

/** Least-squares circle through the edge points near an expected ring. */
function fitRing(points: readonly Point[], centre: Point, radius: number, tolerance: number) {
  const near = points.filter(
    (p) => Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - radius) <= tolerance,
  );
  if (near.length < 12) return null;
  const rows = near.map((p) => [p.x, p.y, 1]);
  const values = near.map((p) => p.x * p.x + p.y * p.y);
  const normal = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0)),
  );
  const right = [0, 1, 2].map((i) => rows.reduce((sum, row, n) => sum + row[i] * values[n], 0));
  const fitted = solve(normal, right);
  if (!fitted) return null;
  const [cx, cy] = [fitted[0] / 2, fitted[1] / 2];
  return { x: cx, y: cy, radius: Math.sqrt(fitted[2] + cx * cx + cy * cy), weight: near.length };
}

interface RingEdge {
  /** Half of a diameter from the template, mm. */
  radius: number;
  lighterInside: boolean;
}

function ringEdges(rings: readonly TargetRing[]): RingEdge[] {
  return rings.flatMap((ring): RingEdge[] =>
    ring.edge === 'light-ring'
      ? [
          { radius: ring.dIn / 2, lighterInside: false },
          { radius: ring.dOut / 2, lighterInside: true },
        ]
      : [{ radius: ring.d / 2, lighterInside: ring.edge === 'light-disc' }],
  );
}

/** Whether the brightness steps the right way across a ring, in most directions. */
function edgeSteps(
  gray: Mat,
  centre: Point,
  radius: number,
  lighterInside: boolean,
  reach: number,
) {
  const pixels = gray.data as Uint8Array;
  const at = (a: number, r: number) => {
    const x = Math.round(centre.x + Math.cos(a) * r);
    const y = Math.round(centre.y + Math.sin(a) * r);
    return x >= 0 && y >= 0 && x < gray.cols && y < gray.rows ? pixels[y * gray.cols + x] : null;
  };
  let right = 0;
  for (let i = 0; i < RING_ANGLES; i++) {
    const a = (i / RING_ANGLES) * 2 * Math.PI;
    const inside = at(a, radius - reach);
    const outside = at(a, radius + reach);
    if (inside == null || outside == null) continue;
    if (lighterInside ? inside - outside > 12 : outside - inside > 12) right++;
  }
  return right / RING_ANGLES >= RING_MIN_COVER;
}

/**
 * Concentric sets of rings on the rectified plane. A candidate counts only if every ring of the
 * template is there, around one centre, with the brightness stepping the right way.
 */
function findRingSets(
  cv: Cv,
  gray: Mat,
  reference: Extract<TargetReference, { kind: 'rings' }>,
  view: PlaneView,
  scope: Scope,
): PlaneElement[] {
  const { k, x0, y0 } = view;
  const radii = reference.diameters.map((d) => (d / 2) * k);
  const outer = Math.max(...radii);
  const inner = Math.min(...radii);
  const edges = scope.own(new cv.Mat());
  cv.Canny(gray, edges, 30, 90);
  const points = edgePoints(edges);
  const tolerance = Math.max(3, 0.8 * k);
  const maxRadius = Math.ceil(outer * RING_SCALE.to + tolerance + 2);
  // One wide search: a range around each ring on its own finds only the strongest circle.
  const candidates = circleCentres(
    cv,
    gray,
    inner,
    inner * RING_SCALE.from,
    outer * RING_SCALE.to,
    scope,
  );
  const sets: (PlaneElement & { score: number })[] = [];
  for (const start of candidates) {
    let centre: Point = start;
    let scale = 1;
    let score = 0;
    let settled = true;
    let fits: NonNullable<ReturnType<typeof fitRing>>[] = [];
    for (let pass = 0; pass < 3 && settled; pass++) {
      const best = bestRingScale(ringCover(points, centre, maxRadius, tolerance), radii);
      if (!best) {
        settled = false;
        break;
      }
      ({ scale, score } = best);
      fits = radii.flatMap((r) => fitRing(points, centre, r * scale, tolerance) ?? []);
      if (fits.length < radii.length) {
        settled = false;
        break;
      }
      const weight = fits.reduce((sum, f) => sum + f.weight, 0);
      centre = {
        x: fits.reduce((sum, f) => sum + f.x * f.weight, 0) / weight,
        y: fits.reduce((sum, f) => sum + f.y * f.weight, 0) / weight,
      };
    }
    if (!settled || fits.some((f) => distance(f, centre) > RING_CENTRE_MM * k)) continue;
    scale = fits.reduce((sum, f, i) => sum + f.radius / radii[i], 0) / fits.length;
    if (reference.rings) {
      const reach = Math.max(3, 0.6 * k);
      const steps = ringEdges(reference.rings).every((edge) =>
        edgeSteps(gray, centre, edge.radius * k * scale, edge.lighterInside, reach),
      );
      if (!steps) continue;
    }
    if (
      sets.some((set) => distance({ x: (set.x - x0) * k, y: (set.y - y0) * k }, centre) < inner)
    ) {
      continue;
    }
    sets.push({
      x: centre.x / k + x0,
      y: centre.y / k + y0,
      kind: 'rings',
      size: (outer * 2 * scale) / k,
      ringScale: scale,
      score,
    });
  }
  return sets.map(({ score: _score, ...set }) => set);
}

const elementSize = (reference: TargetReference): number | null => {
  if (reference.kind === 'rings') return Math.max(...reference.diameters);
  return reference.kind === 'grid' ? null : reference.size;
};

function matchesReference(element: PlaneElement, target: TemplateTarget): boolean {
  const { reference } = target;
  const size = elementSize(reference);
  if (size == null || element.kind !== reference.kind) return false;
  if (reference.kind !== 'rings' && reference.polarity && element.polarity !== reference.polarity) {
    return false;
  }
  return Math.abs(element.size - size) / size < 0.25;
}

interface Located {
  n: number;
  centre: Point;
  aim: Point | null;
  element: PlaneElement | null;
  target: TemplateTarget;
}

/** Finds each target of the template on the plane, trying the turns the sheet can have. */
function locate(
  elements: readonly PlaneElement[],
  layout: Layout,
  plane: Pick<Plane, 'turns' | 'sheet'>,
): Located[] {
  const fits = fitLayout(elements, layout, plane.turns, matchesReference, ELEMENT_REACH);
  const most = Math.max(...fits.map((fit) => fit.found));
  const [best] = fits.filter((fit) => fit.found === most);
  let { shift } = best;
  if (!most && layout.artSize && plane.sheet) {
    // Nothing to go by: most drawings are printed in the middle of the sheet.
    const size = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
    shift = {
      x: plane.sheet.w / 2 - size(best.targets.map((t) => t.x)),
      y: plane.sheet.h / 2 - size(best.targets.map((t) => t.y)),
    };
  }
  return best.targets.map((target, i): Located => {
    const element = best.matched[i];
    const centre: Point = element ?? { x: target.x + shift.x, y: target.y + shift.y };
    return {
      n: target.n,
      centre,
      element,
      target,
      aim: target.aim ? { x: centre.x + target.aim.right, y: centre.y - target.aim.up } : null,
    };
  });
}

function rankHoles(holes: readonly Point[], shots: number | null): DetectedHole[] {
  const limit = shots ?? holes.length;
  return holes.slice(0, Math.max(limit * 2, 1)).map(({ x, y }, i) => ({
    x,
    y,
    doubtful: i >= limit,
  }));
}

function checksOf(located: readonly Located[]): ElementCheck[] {
  return located.flatMap(({ element, target }) => {
    if (!element) return [];
    const expected = elementSize(target.reference);
    return [
      {
        size: element.size,
        angleError: element.angleError,
        ...(expected != null ? { expected } : {}),
      },
    ];
  });
}

function qualityOf(
  plane: FoundPlane,
  image: DetectImage,
  checks: readonly ElementCheck[],
  limits: QualityLimits,
  found?: { missing?: boolean; printScale?: number },
): Quality | null {
  if (!plane.homography) return null;
  const middle = applyHomography(plane.homography, { x: image.width / 2, y: image.height / 2 });
  return assessQuality(
    tiltDegrees(plane.homography, image.width, image.height),
    pxPerMmAt(plane.homography, middle),
    checks,
    limits,
    found,
  );
}

function measureOnImage(
  cv: Cv,
  rgba: Mat,
  plane: Plane,
  request: MeasureRequest,
  scope: Scope,
): MeasureResult {
  const { scale } = plane;
  const radius = ((request.holeMm / 2) * distance(scale.p1, scale.p2)) / scale.mm;
  const holes = rankHoles(findHoles(cv, rgba, radius, [], scope), request.shots);
  const n = request.template?.targets[0]?.n ?? 1;
  return {
    plane: { scale },
    flat: null,
    targets: [{ n, aim: plane.aim ?? null, holes }],
    quality: null,
    elements: [],
  };
}

/** The sheet is good for perspective only: the size comes from what is printed on it. */
function rescaled(plane: Plane, printScale: number): Plane {
  const matrix = plane.homography as number[];
  const sheet = plane.sheet && { w: plane.sheet.w / printScale, h: plane.sheet.h / printScale };
  return {
    ...plane,
    homography: matrix.map((value, i) => (i < 6 ? value / printScale : value)),
    sheet,
    printScale,
    scale: {
      ...plane.scale,
      source: 'element',
      mm: plane.scale.mm / printScale,
      ...(sheet ? { sheet } : {}),
    },
  };
}

function measureOnPlane(
  cv: Cv,
  rgba: Mat,
  plane: Plane,
  request: MeasureRequest,
  scope: Scope,
): MeasureResult {
  const matrix = plane.homography as number[];
  const view = planeView(matrix, request.image, plane.sheet);
  const flat = warp(cv, rgba, matrix, view, scope);
  const gray = toGray(cv, flat, scope);
  const usable = plane.scale.source !== 'card' ? request.template : null;
  const reference = usable?.targets[0]?.reference;
  const elements = [
    ...planeElements(cv, gray, view, scope),
    ...(reference?.kind === 'rings' ? findRingSets(cv, gray, reference, view, scope) : []),
  ];
  const located: Located[] = usable ? locate(elements, usable, plane) : [];
  const checks = checksOf(located);

  const printScale = printScaleOf(checks);
  if (plane.scale.source === 'sheet' && plane.printScale == null && isOffScale(printScale)) {
    return measureOnPlane(cv, rgba, rescaled(plane, printScale), request, scope);
  }

  const toFlat = ({ x, y }: Point): Point => ({
    x: (x - view.x0) * view.k,
    y: (y - view.y0) * view.k,
  });
  // Rings are not solid: shots land inside them.
  const printed = located.flatMap(({ element }) =>
    element && element.kind !== 'rings'
      ? [{ ...toFlat(element), half: (element.size / 2) * view.k }]
      : [],
  );
  const radius = (request.holeMm / 2) * view.k;
  // The edge of the sheet against a light table can pass for a row of holes.
  const bounds = plane.sheet ?? (usable ? usable.sheet : null);
  const onSheet = ({ x, y }: Point) =>
    !bounds ||
    (x > SHEET_INSET &&
      y > SHEET_INSET &&
      x < bounds.w - SHEET_INSET &&
      y < bounds.h - SHEET_INSET);
  const clean =
    usable && request.clean
      ? cleanOnFlat(cv, request.clean, located, usable, plane, view, scope)
      : null;
  const holesMm = findHoles(cv, flat, radius, clean ? [] : printed, scope, clean)
    .map((hole) => ({ x: hole.x / view.k + view.x0, y: hole.y / view.k + view.y0 }))
    .filter(onSheet);
  const places: { n: number; aim: Point | null }[] = usable ? located : [{ n: 1, aim: null }];
  const aims = places.map((target) => target.aim);
  const owners = aims.every(Boolean)
    ? assignToTargets(holesMm, aims as Point[])
    : holesMm.map(() => 0);

  const toImage = invertHomography(matrix);
  const image = (p: Point | null) => (p ? applyHomography(toImage, p) : null);
  return {
    plane: { scale: plane.scale, homography: matrix },
    flat: flatImage(flat, view),
    targets: places.map((target, i) => ({
      n: target.n,
      aim: image(target.aim),
      holes: rankHoles(
        holesMm.filter((_, hole) => owners[hole] === i),
        request.shots,
      ).map((hole) => ({ ...hole, ...(image(hole) as Point) })),
    })),
    quality: qualityOf(plane, request.image, checks, MEASURE_LIMITS, {
      missing: located.some((l) => elementSize(l.target.reference) != null) && !checks.length,
      printScale: plane.printScale,
    }),
    elements: elements
      .filter((e) => e.size > request.holeMm * 1.4)
      .map(({ x, y, kind, size }) => ({ x, y, kind, size })),
  };
}

/** Where a point of the template is on this plane, by the targets found on it. */
function templateToPlane(
  cv: Cv,
  located: readonly Located[],
  layout: Layout,
  plane: Pick<Plane, 'turns'>,
  scope: Scope,
): ((p: Point) => Point) | null {
  const pairs = located.flatMap(({ n, centre }) => {
    const target = layout.targets.find((t) => t.n === n);
    return target ? [{ from: { x: target.x, y: target.y }, to: centre }] : [];
  });
  if (pairs.length >= 4) {
    const matrix = fitHomography(
      cv,
      pairs.map((pair) => pair.from),
      pairs.map((pair) => pair.to),
      scope,
    );
    return matrix && ((p) => applyHomography(matrix, p));
  }
  if (pairs.length >= 2) {
    const [a, b] = [pairs[0], pairs[pairs.length - 1]];
    const [fx, fy] = [b.from.x - a.from.x, b.from.y - a.from.y];
    const [tx, ty] = [b.to.x - a.to.x, b.to.y - a.to.y];
    const length = fx * fx + fy * fy;
    const cosine = (fx * tx + fy * ty) / length;
    const sine = (fx * ty - fy * tx) / length;
    return ({ x, y }) => {
      const [dx, dy] = [x - a.from.x, y - a.from.y];
      return { x: a.to.x + cosine * dx - sine * dy, y: a.to.y + sine * dx + cosine * dy };
    };
  }
  // One target says nothing about a turn, so it only works if there can be none.
  const [only] = pairs;
  if (!only || plane.turns.length > 1) return null;
  return ({ x, y }) => ({ x: x + only.to.x - only.from.x, y: y + only.to.y - only.from.y });
}

/** The template's clean sheet, moved to where the sheet lies on this rectified picture. */
function cleanOnFlat(
  cv: Cv,
  clean: CleanSheet,
  located: readonly Located[],
  layout: Layout,
  plane: Plane,
  view: PlaneView,
  scope: Scope,
): CleanPicture | null {
  const toPlane = templateToPlane(cv, located, layout, plane, scope);
  if (!toPlane) return null;
  const { width, height } = clean.image;
  const from = rectangle(width, height);
  const to = from.map((p) => {
    const mm = toPlane({ x: p.x / clean.k + clean.x0, y: p.y / clean.k + clean.y0 });
    return { x: (mm.x - view.x0) * view.k, y: (mm.y - view.y0) * view.k };
  });
  const matrix = homography(from, to);
  if (!matrix) return null;
  const source = scope.own(cv.matFromImageData(clean.image as ImageData));
  const transform = scope.own(cv.matFromArray(3, 3, cv.CV_64F, [...matrix]));
  const size = new cv.Size(view.width, view.height);
  const moved = scope.own(new cv.Mat());
  cv.warpPerspective(source, moved, transform, size, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  const whole = scope.own(new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255)));
  const covers = scope.own(new cv.Mat());
  cv.warpPerspective(whole, covers, transform, size, cv.INTER_NEAREST, cv.BORDER_CONSTANT);
  return { picture: moved, covers };
}

function manualPlane(manual: NonNullable<MeasureRequest['manual']>): Plane {
  return {
    ...manual,
    sheet: manual.scale.sheet,
    turns: manual.scale.source === 'sheet' ? [0, 1, 2, 3] : [0],
  };
}

function detectMeasure(cv: Cv, rgba: Mat, request: MeasureRequest, scope: Scope): MeasureResult {
  const gray = toGray(cv, rgba, scope);
  const plane = request.manual ? manualPlane(request.manual) : findPlane(cv, gray, request, scope);
  if (!plane) return { plane: null, flat: null, targets: null, quality: null, elements: [] };
  return plane.homography
    ? measureOnPlane(cv, rgba, plane, request, scope)
    : measureOnImage(cv, rgba, plane, request, scope);
}

/** What a measured set of edges is, or null if the rings are drawn as thin lines. */
function classifyRings(
  gray: Mat,
  centre: Point,
  radii: readonly number[],
  k: number,
): TargetRing[] | null {
  if (radii.some((r, i) => i > 0 && r - radii[i - 1] < 1.5 * k)) return null;
  const reach = Math.max(3, 0.6 * k);
  const lighter = radii.map(
    (r) => levelAround(gray, centre, r - reach) > levelAround(gray, centre, r + reach),
  );
  const mm = (r: number) => halfMm((r * 2) / k);
  const rings: TargetRing[] = [];
  for (let i = 0; i < radii.length; i++) {
    if (lighter[i]) rings.push({ edge: 'light-disc', d: mm(radii[i]) });
    else if (lighter[i + 1]) {
      rings.push({ edge: 'light-ring', dIn: mm(radii[i]), dOut: mm(radii[i + 1]) });
      i++;
    } else rings.push({ edge: 'dark-disc', d: mm(radii[i]) });
  }
  return rings;
}

function proposeRings(cv: Cv, gray: Mat, view: PlaneView, scope: Scope) {
  const minimum = 15 * view.k;
  const side = Math.min(gray.cols, gray.rows);
  const edges = scope.own(new cv.Mat());
  cv.Canny(gray, edges, 30, 90);
  const points = edgePoints(edges);
  const rings = circleCentres(cv, gray, minimum * 2, minimum / 2, side / 2, scope).flatMap((c) => {
    const first = ringRadii(edges, c, side / 2);
    if (first.length < 2) return [];
    const fit = fitRing(points, c, Math.max(...first), 4);
    const centre = fit ? { x: fit.x, y: fit.y } : c;
    const radii = ringRadii(edges, centre, Math.max(...first) + 8);
    return radii.length >= 2 ? [{ ...centre, radii }] : [];
  });
  if (!rings.length) return null;
  const outer = Math.max(...rings[0].radii);
  const alike = rings.filter((r) => Math.abs(Math.max(...r.radii) - outer) < outer * 0.05);
  const places = alike.map((r) => ({
    x: r.x / view.k + view.x0,
    y: r.y / view.k + view.y0,
    radii: r.radii,
    rings: classifyRings(gray, r, r.radii, view.k),
  }));
  return {
    targets: readingOrder(places, 15).map((place, i): TemplateTarget => ({
      n: i + 1,
      x: halfMm(place.x),
      y: halfMm(place.y),
      reference: {
        kind: 'rings',
        diameters: place.radii.map((r) => halfMm((r * 2) / view.k)),
        ...(place.rings ? { rings: place.rings } : {}),
      },
      aim: { up: 0, right: 0 },
    })),
    alike: places.map((p) => ({ size: (Math.max(...p.radii) * 2) / view.k })),
  };
}

function proposeGrid(cv: Cv, gray: Mat, view: PlaneView, sheet: SheetSize, scope: Scope) {
  const { columns, rows } = gridLines(cv, gray, scope);
  if (columns.length < 3 || rows.length < 3) return null;
  const step = halfMm(median([...gapsOf(columns), ...gapsOf(rows)]) / view.k);
  const target: TemplateTarget = {
    n: 1,
    x: halfMm(sheet.w / 2),
    y: halfMm(sheet.h / 2),
    reference: { kind: 'grid', step },
    aim: { up: 0, right: 0 },
  };
  return [target];
}

/** Repeating printed elements of a blank sheet: the largest kind, and those alike. */
function proposeTargets(
  cv: Cv,
  gray: Mat,
  elements: readonly PlaneElement[],
  view: PlaneView,
  sheet: SheetSize,
  scope: Scope,
) {
  // Rings first: white lines cut a printed disc into pieces that look like elements of their own.
  const rings = proposeRings(cv, gray, view, scope);
  if (rings) return rings;
  const large = elements.filter((e) => e.size >= MIN_ELEMENT_MM);
  if (!large.length) return { targets: proposeGrid(cv, gray, view, sheet, scope), alike: [] };
  const top = large.reduce((a, b) => (b.size > a.size ? b : a));
  const alike = large.filter(
    (e) => e.kind === top.kind && Math.abs(e.size - top.size) / top.size < 0.15,
  );
  const size = halfMm(median(alike.map((e) => e.size)));
  if (top.kind === 'rings') return { targets: null, alike: [] };
  const reference: TargetReference = {
    kind: top.kind,
    size,
    ...(top.polarity === 'light' ? { polarity: 'light' as const } : {}),
  };
  const targets = readingOrder(alike, size).map((e, i) => ({
    n: i + 1,
    x: halfMm(e.x),
    y: halfMm(e.y),
    reference,
    aim: { up: 0, right: 0 },
  }));
  return { targets, alike };
}

/** Without the corners of the sheet the layout is only known relative to itself. */
function centredOnSheet(targets: TemplateTarget[], sheet: SheetSize): TemplateTarget[] {
  const middle = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
  const dx = sheet.w / 2 - middle(targets.map((t) => t.x));
  const dy = sheet.h / 2 - middle(targets.map((t) => t.y));
  return targets.map((t) => ({ ...t, x: halfMm(t.x + dx), y: halfMm(t.y + dy) }));
}

function detectSurvey(cv: Cv, rgba: Mat, request: SurveyRequest, scope: Scope): SurveyResult {
  const smooth = toGray(cv, rgba, scope);
  const corners = findSheetCorners(cv, smooth, scope);
  const plane =
    (corners && sheetPlane(corners, request.sheet, false)) ?? cardPlane(cv, smooth, scope);
  if (!plane?.homography) {
    return { plane: null, flat: null, quality: null, sheet: null, targets: null };
  }
  const matrix = plane.homography;
  const view = planeView(matrix, request.image, plane.sheet);
  const flat = warp(cv, rgba, matrix, view, scope);
  const gray = toGray(cv, flat, scope);
  const sheet = plane.sheet ?? request.sheet;
  const elements = planeElements(cv, gray, view, scope);
  const { targets, alike } = proposeTargets(cv, gray, elements, view, sheet, scope);
  const checks = alike.map((e: Pick<PlaneElement, 'size' | 'angleError'>) => ({
    size: e.size,
    angleError: e.angleError,
  }));
  return {
    plane: { scale: plane.scale, homography: matrix },
    flat: flatImage(flat, view),
    quality: qualityOf(plane, request.image, checks, TEMPLATE_LIMITS),
    sheet,
    targets: targets && plane.sheet ? targets : targets && centredOnSheet(targets, sheet),
  };
}

export function detectTarget(cv: Cv, request: DetectRequest): DetectResult {
  const scope = new Scope();
  try {
    const rgba = scope.own(cv.matFromImageData(request.image as ImageData));
    switch (request.kind) {
      case 'measure':
        return detectMeasure(cv, rgba, request, scope);
      case 'survey':
        return detectSurvey(cv, rgba, request, scope);
      case 'warp': {
        const view = planeView(request.homography, request.image, request.sheet);
        return { flat: flatImage(warp(cv, rgba, request.homography, view, scope), view) };
      }
    }
  } finally {
    scope.free();
  }
}

/**
 * The Emscripten module is a thenable that resolves to itself, so awaiting it directly never
 * ends. Wrapping it in an object stops the promise machinery from unwrapping it again.
 */
export function openCvReady(module: unknown): Promise<{ cv: Cv }> {
  const thenable = module as { then(done: (cv: Cv) => void): unknown };
  return new Promise((resolve) => {
    thenable.then((cv) => resolve({ cv }));
  });
}
