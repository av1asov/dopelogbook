import { Point } from '../ballistics/model';

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const MIN_CONTRAST = 18;

/** Mean brightness along one axis of a window around the point. */
function profile(image: Pixels, p: Point, radius: number, vertical: boolean): number[] {
  const values: number[] = [];
  const [cx, cy] = [Math.round(p.x), Math.round(p.y)];
  for (let a = -radius; a <= radius; a++) {
    let sum = 0;
    let count = 0;
    for (let b = -radius; b <= radius; b++) {
      const x = vertical ? cx + b : cx + a;
      const y = vertical ? cy + a : cy + b;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      sum += image.data[(y * image.width + x) * 4 + 1];
      count++;
    }
    values.push(count ? sum / count : 255);
  }
  return values;
}

/** The darkest narrow dip nearest the middle of a profile: the offset of a printed line. */
function nearestDip(values: readonly number[]): { offset: number; depth: number } | null {
  const middle = (values.length - 1) / 2;
  const level = [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.7)];
  let best: { offset: number; depth: number } | null = null;
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] || values[i] > values[i + 1]) continue;
    const depth = level - values[i];
    if (depth < MIN_CONTRAST) continue;
    const offset = i - middle;
    if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { offset, depth };
  }
  return best;
}

/**
 * Moves a tap onto the nearest ruler mark. Marks are lines across the ruler, so the point only
 * moves along the axis that has the clearer dip; without one it stays where it was tapped.
 */
export function snapToLine(image: Pixels, p: Point, radius: number): Point {
  const r = Math.round(radius);
  const across = nearestDip(profile(image, p, r, false));
  const down = nearestDip(profile(image, p, r, true));
  if (across && (!down || across.depth >= down.depth)) return { x: p.x + across.offset, y: p.y };
  return down ? { x: p.x, y: p.y + down.offset } : p;
}
