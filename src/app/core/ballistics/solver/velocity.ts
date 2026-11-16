import { Atmosphere, STANDARD_ATMOSPHERE } from './atmosphere';
import { DragModel } from './drag-tables';
import { BallisticInput, integrate, levelEnv, solve } from './trajectory';

export type BoxVelocityAt = 'muzzle' | 'V10' | 'V25';

export interface BoxVelocity {
  /** m/s, as printed on the box. */
  boxVelocity: number;
  /** The test barrel the box speed was measured in, mm. */
  boxBarrelMm?: number | null;
  boxVelocityAt?: BoxVelocityAt | null;
}

export const DEFAULT_BOX_BARREL_MM = 600;
/** Speed lost per centimetre of barrel shorter than the test one, m/s; for rifle calibres. */
export const DEFAULT_BARREL_K = 3;
/** How far off a box-based estimate can be, m/s. */
export const ESTIMATE_ERROR = 20;

/**
 * The muzzle speed for a box speed measured `at` 10 or 25 m: the speed that slows down to
 * the box figure by then. Without a ballistic coefficient the figure is taken as it is.
 */
export function boxToMuzzle(
  box: number,
  at: BoxVelocityAt | null | undefined,
  drag: { bc?: number | null; dragModel?: DragModel | null },
): number {
  const dist = at === 'V10' ? 10 : at === 'V25' ? 25 : 0;
  if (!dist || !drag.bc) return box;
  let v0 = box;
  for (let i = 0; i < 10; i++) {
    const input: BallisticInput = {
      dragModel: drag.dragModel ?? 'G1',
      bc: drag.bc,
      v0,
      sightHeight: 0,
      zeroDist: 100,
      atmosphere: STANDARD_ATMOSPHERE,
    };
    const [sample] = integrate(levelEnv(input), 0, [dist]);
    if (!sample) return box;
    const miss = box - sample.v;
    v0 += miss;
    if (Math.abs(miss) < 0.01) break;
  }
  return v0;
}

/** V₀ ≈ box speed − k · (test barrel − this barrel) / 10, for a barrel `barrelMm` long. */
export function estimateV0(
  box: BoxVelocity,
  barrelMm: number | null | undefined,
  drag: { bc?: number | null; dragModel?: DragModel | null },
  k = DEFAULT_BARREL_K,
): number | null {
  if (!(box.boxVelocity > 0)) return null;
  const muzzle = boxToMuzzle(box.boxVelocity, box.boxVelocityAt, drag);
  if (!(barrelMm && barrelMm > 0)) return muzzle;
  return muzzle - (k * ((box.boxBarrelMm || DEFAULT_BOX_BARREL_MM) - barrelMm)) / 10;
}

/** One series as it goes into the fit. */
export interface FitPoint {
  d: number;
  /** What was dialled plus the group centre, mrad. */
  elev: number;
  /** Hits, so a series of 5 counts more than a series of 2. */
  weight: number;
  atmosphere: Atmosphere;
  /** Passed through to the residuals, to show which series is which. */
  ref?: unknown;
}

export interface FitResidual {
  d: number;
  /** Measured minus calculated, mrad. */
  residual: number;
  ref?: unknown;
}

export interface VelocityFit {
  v0: number;
  /** One standard error, m/s. */
  error: number;
  n: number;
  minD: number;
  maxD: number;
  residuals: FitResidual[];
  /** Only short distances: the speed is poorly pinned down. */
  short: boolean;
}

/** Distances shorter than this hardly depend on V₀ and stay out of the fit. */
export const FIT_MIN_DIST = 200;
/** Without anything past this, the result is flagged as rough. */
export const FIT_SHORT_DIST = 300;

type FitBase = Omit<BallisticInput, 'v0' | 'atmosphere' | 'zeroAtmosphere' | 'wind'>;

/** Calculated corrections, mrad, for each point at speed `v0`; one flight per day's weather. */
function predict(base: FitBase, points: readonly FitPoint[], v0: number): (number | null)[] {
  const groups = new Map<Atmosphere, number[]>();
  points.forEach((p, i) => groups.set(p.atmosphere, [...(groups.get(p.atmosphere) ?? []), i]));
  const out = new Array<number | null>(points.length).fill(null);
  for (const [atmosphere, indexes] of groups) {
    const dists = [...new Set(indexes.map((i) => points[i].d))].sort((a, b) => a - b);
    const rows = solve({ ...base, v0, atmosphere }, dists);
    for (const i of indexes) out[i] = rows.find((r) => r.d === points[i].d)?.elev ?? null;
  }
  return out;
}

function cost(base: FitBase, points: readonly FitPoint[], v0: number): number {
  return predict(base, points, v0).reduce<number>((sum, p, i) => {
    const r = p == null ? 10 : points[i].elev - p;
    return sum + points[i].weight * r * r;
  }, 0);
}

/**
 * V₀ that fits the journal best at a fixed ballistic coefficient: weighted least squares
 * over series at `FIT_MIN_DIST` and further, each in its own day's weather. The error
 * comes from the scatter of the residuals (never below the rounding of whole clicks)
 * over the sensitivity of the corrections to V₀.
 */
export function fitVelocity(
  base: FitBase,
  all: readonly FitPoint[],
  clickMrad: number,
  around = 800,
): VelocityFit | null {
  const points = all.filter((p) => p.d >= FIT_MIN_DIST && p.weight > 0);
  if (!points.length) return null;
  const mean = points.reduce((s, p) => s + p.weight, 0) / points.length;
  const weighted = points.map((p) => ({ ...p, weight: p.weight / mean }));

  // Golden-section search; the cost is smooth and has one minimum over this span.
  let lo = Math.max(250, around - 450);
  let hi = around + 450;
  const golden = (Math.sqrt(5) - 1) / 2;
  let a = hi - golden * (hi - lo);
  let b = lo + golden * (hi - lo);
  let fa = cost(base, weighted, a);
  let fb = cost(base, weighted, b);
  while (hi - lo > 0.05) {
    if (fa < fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - golden * (hi - lo);
      fa = cost(base, weighted, a);
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + golden * (hi - lo);
      fb = cost(base, weighted, b);
    }
  }
  const v0 = (lo + hi) / 2;

  const at = predict(base, weighted, v0);
  const up = predict(base, weighted, v0 + 1);
  const down = predict(base, weighted, v0 - 1);
  const residuals = weighted.map((p, i) => ({
    d: p.d,
    residual: p.elev - (at[i] ?? 0),
    ref: p.ref,
  }));
  const n = weighted.length;
  const scatter =
    residuals.reduce((s, r, i) => s + weighted[i].weight * r.residual ** 2, 0) / Math.max(1, n - 1);
  const rounding = clickMrad ** 2 / 12;
  const sensitivity = weighted.reduce((s, p, i) => {
    const slope = ((up[i] ?? 0) - (down[i] ?? 0)) / 2;
    return s + p.weight * slope * slope;
  }, 0);
  const error = sensitivity > 0 ? Math.sqrt(Math.max(scatter, rounding) / sensitivity) : Infinity;
  const ds = weighted.map((p) => p.d);
  const maxD = Math.max(...ds);
  return {
    v0,
    error,
    n,
    minD: Math.min(...ds),
    maxD,
    residuals,
    short: maxD <= FIT_SHORT_DIST,
  };
}
