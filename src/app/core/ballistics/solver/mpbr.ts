import {
  angleForZero,
  BallisticInput,
  distances,
  Env,
  integrate,
  levelEnv,
  zeroAngle,
} from './trajectory';

/** One trajectory read against the kill zone; heights are mm over the line of sight. */
export interface MpbrLine {
  /** Barrel over the line of sight, rad. */
  angle: number;
  /** Where the bullet first crosses the line of sight going up, m. */
  near: number | null;
  /** Where it crosses it coming down, m. */
  far: number | null;
  peak: { h: number; d: number };
  /** Where it drops out of the zone below, m; null beyond reach. */
  mpbr: number | null;
  /** Where it flies over the zone, m, when the peak is higher than the radius. */
  above: readonly [number, number] | null;
}

export interface MpbrResult {
  /** mm */
  radius: number;
  /** The peak is exactly the radius: the longest point-blank range. */
  optimal: MpbrLine;
  /** Zeroed so that the near zero is at each distance asked for. */
  nears: { dist: number; line: MpbrLine }[];
  /** The scope as it is zeroed now. */
  current: MpbrLine | null;
  /** The sight is higher than the radius: the first metres are under the zone. */
  sightBelowZone: boolean;
}

export const NEAR_ZEROS: readonly number[] = [25, 30, 35, 40];
const REACH = 1000;
const STEPS = distances(1, REACH);
/** m */
const ABOVE_TOLERANCE = 0.0005;

function trace(e: Env, angle: number, radius: number): MpbrLine {
  let peak = { h: -e.sight, d: 0 };
  let prev = { h: -e.sight, d: 0 };
  let near: number | null = null;
  let far: number | null = null;
  let mpbr: number | null = null;
  let overFrom: number | null = null;
  let overTo: number | null = null;
  integrate(e, angle, STEPS, (s) => {
    const cross = (level: number) => prev.d + ((level - prev.h) / (s.h - prev.h)) * (s.d - prev.d);
    if (s.h > peak.h) peak = { h: s.h, d: s.d };
    if (near == null && prev.h < 0 && s.h >= 0) near = cross(0);
    else if (near != null && far == null && prev.h >= 0 && s.h < 0) far = cross(0);
    if (overFrom == null && prev.h <= radius && s.h > radius) overFrom = cross(radius);
    else if (overFrom != null && overTo == null && prev.h > radius && s.h <= radius) {
      overTo = cross(radius);
    }
    // Rising from under the zone at the muzzle is not leaving it.
    if (prev.h >= -radius && s.h < -radius) mpbr = cross(-radius);
    prev = s;
    return mpbr != null;
  });
  return {
    angle,
    near,
    far,
    peak: { h: peak.h * 1000, d: peak.d },
    mpbr,
    // The optimal line touches the top of the zone; a fraction of a millimetre is not over it.
    above:
      overFrom != null && peak.h - radius > ABOVE_TOLERANCE ? [overFrom, overTo ?? REACH] : null,
  };
}

/** Bisection on the barrel angle until the peak is the radius. */
function optimalAngle(e: Env, radius: number): number {
  let lo = 0;
  let hi = 0.05;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const peak = trace(e, mid, radius).peak.h / 1000;
    if (Math.abs(peak - radius) < 1e-6) return mid;
    if (peak > radius) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Point-blank range for a kill zone `zoneDiameterMm` across. Level shot, no wind. */
export function mpbr(
  input: BallisticInput,
  zoneDiameterMm: number,
  nears: readonly number[] = NEAR_ZEROS,
): MpbrResult {
  const e = levelEnv(input);
  const radius = zoneDiameterMm / 2000;
  const nearLines = nears.flatMap((dist) => {
    const angle = angleForZero(input, dist);
    return angle == null ? [] : [{ dist, line: trace(e, angle, radius) }];
  });
  const current = zeroAngle(input);
  return {
    radius: radius * 1000,
    optimal: trace(e, optimalAngle(e, radius), radius),
    nears: nearLines,
    current: current == null ? null : trace(e, current, radius),
    sightBelowZone: input.sightHeight > radius * 1000,
  };
}

/** Heights over the line of sight, mm, from the muzzle to `maxDist`, for a chart. */
export function profile(
  input: BallisticInput,
  angle: number,
  maxDist: number,
  step = 2,
): { d: number; h: number }[] {
  const samples = integrate(levelEnv(input), angle, distances(step, maxDist));
  return [{ d: 0, h: -input.sightHeight }, ...samples.map((s) => ({ d: s.d, h: s.h * 1000 }))];
}

/** Height of a profile at `d`, between its points; null outside it. */
function heightOn(points: readonly { d: number; h: number }[], d: number): number | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (d >= a.d && d <= b.d) return a.h + ((b.h - a.h) * (d - a.d)) / (b.d - a.d);
  }
  return null;
}

/**
 * Where the bullet really leaves the zone by the journal, m; null unless journal points lie on
 * both sides of that place. The trajectory is convex, so a straight line between the journal
 * heights would run under it and shorten the range: the miss r(d) = h_journal − h_calc is
 * interpolated instead, and the fact is h_calc + r crossing −radius.
 * `calc` and `journal` are heights over the line of sight, mm, sorted by distance.
 */
export function factMpbr(
  calc: readonly { d: number; h: number }[],
  journal: readonly { d: number; h: number }[],
  radius: number,
): number | null {
  const misses = journal.flatMap((p) => {
    const h = heightOn(calc, p.d);
    return h == null ? [] : [{ d: p.d, r: p.h - h }];
  });
  if (misses.length < 2) return null;
  const from = misses[0].d;
  const to = misses[misses.length - 1].d;
  const ds = [
    ...new Set([
      ...misses.map((m) => m.d),
      ...calc.map((p) => p.d).filter((d) => d > from && d < to),
    ]),
  ].sort((a, b) => a - b);
  let prev: { d: number; h: number } | null = null;
  for (const d of ds) {
    const h =
      (heightOn(calc, d) as number) +
      (heightOn(
        misses.map((m) => ({ d: m.d, h: m.r })),
        d,
      ) as number);
    if (prev && prev.h >= -radius && h < -radius) {
      return prev.d + ((-radius - prev.h) / (h - prev.h)) * (d - prev.d);
    }
    prev = { d, h };
  }
  return null;
}
