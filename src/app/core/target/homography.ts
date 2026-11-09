import { Point } from '../ballistics/model';

/** A 3×3 projective transform, row by row. */
export type Homography = readonly number[];

/** Gaussian elimination with pivoting; null when the system has no single solution. */
export function solve(matrix: number[][], values: number[]): number[] | null {
  const n = values.length;
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) < 1e-9) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = rows[r][col] / rows[col][col];
      for (let c = col; c <= n; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  return rows.map((row, i) => row[n] / row[i]);
}

/** The transform that takes four points to four others; null if three of them are collinear. */
export function homography(from: readonly Point[], to: readonly Point[]): Homography | null {
  const matrix: number[][] = [];
  const values: number[] = [];
  from.forEach(({ x, y }, i) => {
    const { x: u, y: v } = to[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  });
  const solved = solve(matrix, values);
  return solved ? [...solved, 1] : null;
}

export function applyHomography(h: Homography, { x, y }: Point): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, i, j] = h;
  const m = [
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];
  return m.map((value) => value / m[8]);
}

/** Pixels per millimetre around a point of the plane; `h` goes from image to plane. */
export function pxPerMmAt(h: Homography, plane: Point): number {
  const inverse = invertHomography(h);
  const at = (x: number, y: number) => applyHomography(inverse, { x: plane.x + x, y: plane.y + y });
  const across = at(1, 0);
  const down = at(0, 1);
  const here = at(0, 0);
  return (
    (Math.hypot(across.x - here.x, across.y - here.y) +
      Math.hypot(down.x - here.x, down.y - here.y)) /
    2
  );
}

/** A phone's main camera: focal length as a share of the long side of the frame. */
const FOCAL_SHARE = 0.7;

/** Angle between the camera axis and the normal of the plane, degrees. */
export function tiltDegrees(h: Homography, width: number, height: number): number {
  const m = invertHomography(h);
  const focal = Math.max(width, height) * FOCAL_SHARE;
  const [cx, cy] = [width / 2, height / 2];
  const column = (x: number, y: number, z: number) => {
    const v = [(x - cx * z) / focal, (y - cy * z) / focal, z];
    const length = Math.hypot(v[0], v[1], v[2]);
    return v.map((value) => value / length);
  };
  const r1 = column(m[0], m[3], m[6]);
  const r2 = column(m[1], m[4], m[7]);
  const normal = [
    r1[1] * r2[2] - r1[2] * r2[1],
    r1[2] * r2[0] - r1[0] * r2[2],
    r1[0] * r2[1] - r1[1] * r2[0],
  ];
  const cosine = Math.abs(normal[2]) / Math.hypot(normal[0], normal[1], normal[2]);
  return (Math.acos(Math.min(1, cosine)) * 180) / Math.PI;
}

export function rectangle(w: number, h: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

/** Puts four points in the order top left, top right, bottom right, bottom left. */
export function orderCorners(points: readonly Point[]): [Point, Point, Point, Point] {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const clockwise = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const sums = clockwise.map((p) => p.x + p.y);
  const first = sums.indexOf(Math.min(...sums));
  const at = (i: number) => clockwise[(first + i) % clockwise.length];
  return [at(0), at(1), at(2), at(3)];
}
