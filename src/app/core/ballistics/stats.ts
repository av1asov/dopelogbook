import { ammoById, combosOf, sessionsOf } from './diary';
import { afterZero, dopePoints, interp, zeroInfo } from './dope';
import { Ammo, Diary, Rifle, Series, Session, Units } from './model';
import {
  elevEff,
  isStable,
  seriesGroupAng,
  seriesMatches,
  seriesStatus,
  sessionRounds,
} from './series';

export interface GroupEntry {
  session: Session;
  series: Series;
  /** Angular size, mrad. */
  angle: number;
}

export interface GroupStats {
  n: number;
  avg: number;
  best: number;
}

export interface StanceRow {
  pos: string;
  rest: string;
  n: number;
  avg: number;
}

export interface ColdStats {
  n: number;
  /** Average offset of the first shot, mrad, positive up. */
  up: number;
  /** Average offset of the first shot, mrad, positive right. */
  right: number;
}

export interface AmmoComparisonRow {
  ammo: Ammo;
  values: number[];
  avg: number;
}

export interface StabilityPoint {
  session: Session;
  series: Series;
  dist: number;
  value: number;
  /** Difference from the card when it is at or beyond the tolerance. */
  deviation: number | null;
}

export interface BarrelPoint {
  session: Session;
  total: number;
}

const average = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/** Groups of 3+ shots, newest session first. */
export function groupsOf(d: Diary, rifleId: string, ammoId?: string | null): GroupEntry[] {
  return sessionsOf(d, rifleId, ammoId).flatMap((session) =>
    session.series.flatMap((series, si): GroupEntry[] => {
      if (!seriesMatches(series, ammoId)) return [];
      const angle = seriesGroupAng(session, si);
      return angle == null ? [] : [{ session, series, angle }];
    }),
  );
}

export function groupStats(
  d: Diary,
  rifleId: string,
  ammoId?: string | null,
  stableOnly = false,
): GroupStats | null {
  const values = groupsOf(d, rifleId, ammoId)
    .filter((g) => !stableOnly || isStable(g.series))
    .map((g) => g.angle);
  if (!values.length) return null;
  return { n: values.length, avg: average(values), best: Math.min(...values) };
}

/** Best stance first. */
export function stanceStats(d: Diary, rifleId: string): StanceRow[] {
  const byStance = new Map<string, { pos: string; rest: string; values: number[] }>();
  for (const { series, angle } of groupsOf(d, rifleId)) {
    const pos = series.pos || '';
    const rest = series.rest || '';
    const key = `${pos}|${rest}`;
    const entry = byStance.get(key) ?? { pos, rest, values: [] };
    entry.values.push(angle);
    byStance.set(key, entry);
  }
  return [...byStance.values()]
    .map(({ pos, rest, values }) => ({ pos, rest, n: values.length, avg: average(values) }))
    .sort((a, b) => a.avg - b.avg);
}

export function coldStats(d: Diary, rifleId: string): ColdStats | null {
  const offsets: { up: number; right: number }[] = [];
  for (const s of sessionsOf(d, rifleId)) {
    const cold = s.coldShot;
    if (!cold || (cold.offUp == null && cold.offRight == null)) continue;
    const dist = (cold.standalone ? cold.standalone.dist : s.series[cold.si]?.dist) ?? 0;
    if (dist > 0)
      offsets.push({ up: (cold.offUp || 0) / dist, right: (cold.offRight || 0) / dist });
  }
  if (!offsets.length) return null;
  return {
    n: offsets.length,
    up: average(offsets.map((o) => o.up)),
    right: average(offsets.map((o) => o.right)),
  };
}

/** Stable rests only, tightest ammo first. Values are in mrad. */
export function ammoComparison(d: Diary, rifle: Rifle): AmmoComparisonRow[] {
  return combosOf(d, rifle)
    .flatMap((combo): AmmoComparisonRow[] => {
      const ammo = ammoById(d, combo.ammoId);
      const values = groupsOf(d, rifle.id, combo.ammoId)
        .filter((g) => isStable(g.series))
        .map((g) => g.angle);
      return ammo && values.length ? [{ ammo, values, avg: average(values) }] : [];
    })
    .sort((a, b) => a.avg - b.avg);
}

/** Every usable series after the current zero, compared with the DOPE card. */
export function correctionStability(
  d: Diary,
  rifleId: string,
  ammoId: string,
  units: Units,
): StabilityPoint[] {
  const tolerance = units === 'MOA' ? 0.7 : 0.2;
  const zero = zeroInfo(d, rifleId);
  const card = dopePoints(d, rifleId, ammoId).elev;
  return sessionsOf(d, rifleId, ammoId)
    .filter((session) => afterZero(session, zero))
    .flatMap((session) =>
      session.series.flatMap((series): StabilityPoint[] => {
        if (!seriesMatches(series, ammoId) || !seriesStatus(series).use) return [];
        const dist = series.dist as number;
        const value = elevEff(series, units) as number;
        const ref = interp(card, dist);
        const deviation = ref && Math.abs(value - ref.v) >= tolerance ? value - ref.v : null;
        return [{ session, series, dist, value, deviation }];
      }),
    );
}

/** Cumulative rounds per session, oldest first. */
export function barrelLife(d: Diary, rifleId: string): BarrelPoint[] {
  let total = 0;
  return sessionsOf(d, rifleId)
    .reverse()
    .map((session) => ({ session, total: (total += sessionRounds(session)) }));
}
