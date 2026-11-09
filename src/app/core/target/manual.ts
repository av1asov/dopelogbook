import { Point, SheetSize } from '../ballistics/model';
import {
  applyHomography,
  Homography,
  homography,
  invertHomography,
  orderCorners,
  rectangle,
} from './homography';
import { distance, meanPoint, turnPoint } from './measure';

export type ManualElement = 'circle' | 'square';

/** What was marked by hand on screen 16b, in pixels of the original shot. */
export interface ManualMarks {
  /** Null while the sheet corners have not been touched. */
  corners: readonly Point[] | null;
  /** The ends of the scale segment; up to two. */
  segment: readonly Point[];
  /** The length of the segment. */
  mm: number | null;
  /** One place for each number of the template; empty until marked. */
  centres: readonly (Point | null)[];
  /** Point of aim of the first target, when it is not in the centre. */
  aim: Point | null;
  /** A point on the edge of the first reference element. */
  edge: Point | null;
  element: ManualElement;
  /** The edge was dragged, so its size means something. */
  sized: boolean;
}

export interface ManualLayout {
  places: Point[] | null;
  element: { kind: ManualElement; size: number } | null;
  aim: { up: number; right: number } | null;
}

const FRAME_INSET = 0.08;
export const MIN_SEGMENT_MM = 50;
export const SHEET_TOLERANCE = 0.02;

const toTenth = (value: number): number => Math.round(value * 10) / 10;
const toHalf = (value: number): number => Math.round(value * 2) / 2;

/** Where the corner markers start when nothing was found: just inside the edges of the shot. */
export function frameCorners({ w, h }: SheetSize): Point[] {
  const [x, y] = [w * FRAME_INSET, h * FRAME_INSET];
  return [
    { x, y },
    { x: w - x, y },
    { x: w - x, y: h - y },
    { x, y: h - y },
  ];
}

/** Where a sheet found on the plane lies on the shot. */
export function sheetCorners(matrix: Homography, sheet: SheetSize): Point[] {
  const inverse = invertHomography(matrix);
  return rectangle(sheet.w, sheet.h).map((corner) => applyHomography(inverse, corner));
}

/** The longer side on the shot is the longer side of the sheet, whichever way it lies. */
export function sheetPlane(
  corners: readonly Point[],
  sheet: SheetSize,
): { matrix: number[]; sheet: SheetSize } | null {
  const points = orderCorners(corners);
  const wider = distance(points[0], points[1]) > distance(points[0], points[3]);
  const size = wider !== sheet.w > sheet.h ? { w: sheet.h, h: sheet.w } : sheet;
  const matrix = homography(points, rectangle(size.w, size.h));
  return matrix ? { matrix: [...matrix], sheet: size } : null;
}

/** Resolution of the segment, and what one pixel at each end does to its length. */
export function segmentReading(
  segment: readonly Point[],
  mm: number | null,
): { pxPerMm: number; errorMm: number } | null {
  if (segment.length < 2 || !mm || mm <= 0) return null;
  const pxPerMm = distance(segment[0], segment[1]) / mm;
  return pxPerMm > 0 ? { pxPerMm, errorMm: Math.SQRT2 / pxPerMm } : null;
}

/** How many real millimetres one millimetre of the rectified plane is, by the segment. */
function planeScale(marks: ManualMarks, matrix: Homography | null): number {
  const [a, b] = marks.segment;
  if (!matrix || !a || !b || !marks.mm || marks.mm <= 0) return 1;
  const measured = distance(applyHomography(matrix, a), applyHomography(matrix, b));
  return measured > 0 ? marks.mm / measured : 1;
}

/** The width of the sheet as the segment sees it, to compare with the size it should have. */
export function sheetCheck(
  marks: ManualMarks,
  matrix: Homography | null,
  sheet: SheetSize,
): { width: number; off: boolean } | null {
  if (!matrix || !segmentReading(marks.segment, marks.mm)) return null;
  const k = planeScale(marks, matrix);
  return { width: sheet.w * k, off: Math.abs(k - 1) > SHEET_TOLERANCE };
}

function converter(marks: ManualMarks, matrix: Homography | null): ((p: Point) => Point) | null {
  if (matrix) {
    const k = planeScale(marks, matrix);
    return (p) => {
      const { x, y } = applyHomography(matrix, p);
      return { x: x * k, y: y * k };
    };
  }
  const reading = segmentReading(marks.segment, marks.mm);
  if (!reading) return null;
  return ({ x, y }) => ({ x: x / reading.pxPerMm, y: y / reading.pxPerMm });
}

/** Whether the centres marked can be turned into millimetres at all. */
export function canMeasure(marks: ManualMarks, matrix: Homography | null): boolean {
  return !!converter(marks, matrix);
}

/**
 * The template layout in millimetres. Without a sheet on the plane only the distances between
 * targets are known, so the layout goes in the middle of the sheet.
 */
export function manualLayout(
  marks: ManualMarks,
  matrix: Homography | null,
  onSheet: boolean,
  sheet: SheetSize,
): ManualLayout {
  const toMm = converter(marks, matrix);
  const centres = marks.centres.filter((p): p is Point => !!p);
  if (!toMm || !centres.length) return { places: null, element: null, aim: null };
  const first = toMm(centres[0]);
  const raw = centres.map(toMm);
  const middle = meanPoint(raw) as Point;
  const [dx, dy] = onSheet ? [0, 0] : [sheet.w / 2 - middle.x, sheet.h / 2 - middle.y];
  const aim = marks.aim && toMm(marks.aim);
  return {
    places: raw.map(({ x, y }) => ({ x: toTenth(x + dx), y: toTenth(y + dy) })),
    element:
      marks.sized && marks.edge
        ? { kind: marks.element, size: toHalf(2 * distance(first, toMm(marks.edge))) }
        : null,
    aim: aim ? { up: toTenth(first.y - aim.y), right: toTenth(aim.x - first.x) } : null,
  };
}

/** Marks follow the shot when it turns. */
export function turnManual(marks: ManualMarks, photo: SheetSize, quarters: number): ManualMarks {
  const turn = (p: Point): Point => turnPoint(photo, quarters, p);
  return {
    ...marks,
    corners: marks.corners && marks.corners.map(turn),
    segment: marks.segment.map(turn),
    centres: marks.centres.map((p) => p && turn(p)),
    aim: marks.aim && turn(marks.aim),
    edge: marks.edge && turn(marks.edge),
  };
}
