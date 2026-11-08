import { ammoById, comboOf, combosOf, rifleById, seriesFor, sessionsOf } from './diary';
import { fmtSigned, rdate } from './format';
import { Ammo, Combo, Diary, Rifle, Session, Units } from './model';
import { elevEff, seriesStatus, toUnits } from './series';

export interface ZeroInfo {
  dist: number;
  derived: boolean;
  date?: string;
  ammoId?: string;
  sessionId?: string;
}

export interface DopePoint {
  d: number;
  v: number;
  date: string;
  adj: boolean;
}

export interface WindPoint {
  d: number;
  v: number;
  date: string;
}

export interface DopePoints {
  elev: DopePoint[];
  wind: WindPoint[];
  sessions: number;
  temps: number[];
  before: number;
  zero: ZeroInfo | null;
}

export interface Interpolated {
  v: number;
  exact: boolean;
}

export interface CardOptions {
  step: number;
  from?: number | null;
  to?: number | null;
  device?: string;
  rest?: string;
}

export interface CardRow {
  d: number;
  e: Interpolated;
  w: Interpolated | null;
  clicks: number | null;
}

export interface CardData {
  rifle: Rifle;
  ammo: Ammo | null;
  combo: Combo | null;
  points: DopePoints;
  rows: CardRow[];
}

export interface CardNote {
  kind: 'warn' | 'hint';
  text: string;
}

/**
 * The latest session marked as a re-zero; without one, the distance where the
 * elevation was most often 0.
 */
export function zeroInfo(d: Diary, rifleId: string): ZeroInfo | null {
  const sessions = sessionsOf(d, rifleId);
  const marked = sessions.find((s) => s.rezero && s.rezero.dist > 0);
  if (marked?.rezero) {
    return {
      dist: marked.rezero.dist,
      date: marked.date || '',
      ammoId: marked.rezero.ammoId || marked.series[0]?.ammoId,
      sessionId: marked.id,
      derived: false,
    };
  }
  const counts = new Map<number, number>();
  for (const s of sessions) {
    for (const x of s.series) {
      if (seriesStatus(x).use && (x.dist ?? 0) > 0 && x.elev === 0) {
        counts.set(x.dist as number, (counts.get(x.dist as number) ?? 0) + 1);
      }
    }
  }
  if (!counts.size) return null;
  return { dist: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0], derived: true };
}

export const afterZero = (s: Session, zero: ZeroInfo | null): boolean =>
  !zero || zero.derived || (s.date || '') >= (zero.date as string);

/** For each distance the latest usable series wins, so sessions are read oldest first. */
export function dopePoints(
  d: Diary,
  rifleId: string,
  ammoId: string | null | undefined,
  device = '*',
  rest = '*',
): DopePoints {
  const units = rifleById(d, rifleId)?.units ?? 'MIL';
  const zero = zeroInfo(d, rifleId);
  const all = sessionsOf(d, rifleId, ammoId).filter(
    (s) => seriesFor(s, ammoId, device, rest).length,
  );
  const current = all.filter((s) => afterZero(s, zero)).reverse();
  const elev = new Map<number, Omit<DopePoint, 'd'>>();
  const wind = new Map<number, Omit<WindPoint, 'd'>>();
  const used = new Set<string>();
  const temps: number[] = [];
  for (const s of current) {
    for (const x of seriesFor(s, ammoId, device, rest)) {
      if (!seriesStatus(x).use) continue;
      const dist = x.dist as number;
      elev.set(dist, {
        v: elevEff(x, units) as number,
        date: s.date,
        adj: x.offUp != null,
      });
      if (!used.has(s.id) && s.temp != null) temps.push(s.temp);
      used.add(s.id);
      if (x.windSpeed && x.windCorr != null) {
        wind.set(dist, { v: x.windCorr / x.windSpeed, date: s.date });
      }
    }
  }
  const sorted = <T>(m: Map<number, T>) =>
    [...m.entries()].map(([k, v]) => ({ d: k, ...v })).sort((a, b) => a.d - b.d);
  return {
    elev: sorted(elev),
    wind: sorted(wind),
    sessions: used.size,
    temps,
    before: all.length - current.length,
    zero,
  };
}

/** Exact point or linear interpolation; null outside the measured range. */
export function interp(
  points: readonly { d: number; v: number }[],
  dist: number,
): Interpolated | null {
  const hit = points.find((p) => p.d === dist);
  if (hit) return { v: hit.v, exact: true };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (dist > a.d && dist < b.d) {
      return { v: a.v + ((b.v - a.v) * (dist - a.d)) / (b.d - a.d), exact: false };
    }
  }
  return null;
}

/** The requested ammo if the rifle has it, else the first one with data. */
export function cardAmmoId(
  d: Diary,
  rifle: Rifle,
  current: string | null | undefined,
  device = '*',
  rest = '*',
): string | null {
  const combos = combosOf(d, rifle);
  if (!combos.length) return null;
  if (current && combos.some((c) => c.ammoId === current)) return current;
  const withData = combos.find((c) => dopePoints(d, rifle.id, c.ammoId, device, rest).elev.length);
  return (withData ?? combos[0]).ammoId;
}

export function cardRows(
  d: Diary,
  rifle: Rifle,
  ammoId: string | null | undefined,
  options: CardOptions,
): CardData {
  const { step, device = '*', rest = '*' } = options;
  const ammo = ammoById(d, ammoId);
  const combo = comboOf(d, rifle, ammoId);
  const points = dopePoints(d, rifle.id, ammoId, device, rest);
  if (!ammo || !points.elev.length) return { rifle, ammo, combo, points, rows: [] };

  const from = options.from ?? points.elev[0].d;
  const to = options.to ?? points.elev[points.elev.length - 1].d;
  const dists = new Set<number>();
  for (let dist = Math.ceil(from / step) * step; dist <= to; dist += step) dists.add(dist);
  for (const p of points.elev) if (p.d >= from && p.d <= to) dists.add(p.d);

  const rows = [...dists]
    .sort((a, b) => a - b)
    .flatMap((dist): CardRow[] => {
      const e = interp(points.elev, dist);
      if (!e) return [];
      const clicks = rifle.click ? Math.round(e.v / rifle.click) : null;
      return [{ d: dist, e, w: interp(points.wind, dist), clicks }];
    });
  return { rifle, ammo, combo, points, rows };
}

export function offsetAtZero(d: Diary, rifleId: string, ammoId: string): number | null {
  const zero = zeroInfo(d, rifleId);
  if (!zero) return null;
  return dopePoints(d, rifleId, ammoId).elev.find((p) => p.d === zero.dist)?.v ?? null;
}

const usedValues = (
  d: Diary,
  rifleId: string,
  ammoId: string | null | undefined,
  pick: (x: { device?: string; rest?: string }) => string | undefined,
): string[] => [
  ...new Set(
    sessionsOf(d, rifleId, ammoId)
      .flatMap((s) => seriesFor(s, ammoId))
      .filter((x) => seriesStatus(x).use)
      .map((x) => pick(x) || ''),
  ),
];

export const devicesUsed = (d: Diary, rifleId: string, ammoId?: string | null): string[] =>
  usedValues(d, rifleId, ammoId, (x) => x.device);

export const restsUsed = (d: Diary, rifleId: string, ammoId?: string | null): string[] =>
  usedValues(d, rifleId, ammoId, (x) => x.rest);

/** Average vertical offset per rest (2+ series each), when rests differ noticeably. */
export function restShift(
  d: Diary,
  rifleId: string,
  ammoId: string,
  units: Units,
  device = '*',
): { rest: string; avg: number }[] | null {
  const byRest = new Map<string, number[]>();
  for (const s of sessionsOf(d, rifleId, ammoId)) {
    for (const x of seriesFor(s, ammoId, device)) {
      if (!seriesStatus(x).use || x.offUp == null || !((x.dist ?? 0) > 0)) continue;
      const key = x.rest || '';
      byRest.set(key, [...(byRest.get(key) ?? []), toUnits(x.offUp / (x.dist as number), units)]);
    }
  }
  const rows = [...byRest.entries()]
    .filter(([, values]) => values.length >= 2)
    .map(([rest, values]) => ({
      rest,
      avg: values.reduce((sum, v) => sum + v, 0) / values.length,
    }));
  if (rows.length < 2) return null;
  const spread = Math.max(...rows.map((r) => r.avg)) - Math.min(...rows.map((r) => r.avg));
  return spread >= (units === 'MOA' ? 0.7 : 0.2) ? rows : null;
}

export function zeroNotes(ammo: Ammo | null, points: DopePoints, units: Units): CardNote[] {
  const zero = points.zero;
  const notes: CardNote[] = [];
  if (!zero) {
    notes.push({
      kind: 'warn',
      text: 'Пристрелка не отмечена. Отметьте в записи стрельбы день, когда выставляли ноль.',
    });
  } else if (!zero.derived && points.before) {
    notes.push({
      kind: 'hint',
      text: `Не учтено ${points.before} стр. до пристрелки ${rdate(zero.date)}: тогда ноль был другим.`,
    });
  }
  if (zero && !zero.derived && ammo?.id === zero.ammoId) {
    const off = points.elev.find((p) => p.d === zero.dist);
    if (off && Math.abs(off.v) >= (units === 'MOA' ? 0.75 : 0.2)) {
      notes.push({
        kind: 'warn',
        text: `Патрону, под который пристрелян прицел, на ${zero.dist} м потребовалась поправка ${fmtSigned(off.v)} ${units}. Похоже, ноль сместился: проверьте крепление и при необходимости перепристреляйте.`,
      });
    }
  }
  return notes;
}
