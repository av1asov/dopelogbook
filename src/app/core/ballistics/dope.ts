import { ammoById, comboOf, combosOf, scopeById, seriesFor, sessionsOf } from './diary';
import { fmtSigned, rdate, shortDate } from './format';
import { Ammo, Combo, Diary, Rifle, Scope, ScopeUnits, Session, ZeroEvent } from './model';
import { ammoName, elevEff, seriesMatches, seriesStatus, toUnits, unitLabel } from './series';

/** A correction this far from the card or from zero, in mrad, is worth a warning. */
export const ZERO_TOLERANCE = 0.2;

export interface ZeroInfo {
  dist: number;
  derived: boolean;
  date?: string;
  ammoId?: string;
  sessionId?: string;
  /** Series of `sessionId` up to this index were fired before the zero. */
  afterSi?: number;
  createdAt?: string;
}

/** Values are mrad. */
export interface DopePoint {
  d: number;
  v: number;
  date: string;
  adj: boolean;
}

/** Values are mrad per 1 m/s. */
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

/** `e` and `w` are in the units of the card's scope. */
export interface CardRow {
  d: number;
  e: Interpolated;
  w: Interpolated | null;
  clicks: number | null;
}

export interface CardData {
  rifle: Rifle;
  scope: Scope | null;
  ammo: Ammo | null;
  combo: Combo | null;
  points: DopePoints;
  rows: CardRow[];
}

export interface CardNote {
  kind: 'warn' | 'hint';
  text: string;
}

function lastZeroEvent(s: Session, scopeId: string): ZeroEvent | null {
  let last: ZeroEvent | null = null;
  for (const event of s.zeroEvents ?? []) {
    if (event.scopeId !== scopeId || !(event.dist > 0)) continue;
    if (!last || event.afterSi >= last.afterSi) last = event;
  }
  return last;
}

/**
 * The latest zero mark of this rifle and scope; without one, the distance where the
 * elevation was most often 0.
 */
export function zeroInfo(d: Diary, rifleId: string, scopeId: string): ZeroInfo | null {
  const sessions = sessionsOf(d, rifleId);
  for (const s of sessions) {
    const event = lastZeroEvent(s, scopeId);
    if (event) {
      return {
        dist: event.dist,
        date: s.date || '',
        ammoId: event.ammoId,
        sessionId: s.id,
        afterSi: event.afterSi,
        createdAt: s.createdAt,
        derived: false,
      };
    }
  }
  const counts = new Map<number, number>();
  for (const s of sessions) {
    for (const x of s.series) {
      if (x.scopeId === scopeId && seriesStatus(x).use && (x.dist ?? 0) > 0 && x.elev === 0) {
        counts.set(x.dist as number, (counts.get(x.dist as number) ?? 0) + 1);
      }
    }
  }
  if (!counts.size) return null;
  return { dist: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0], derived: true };
}

/** «ноль 100 м под Igla Shakal 160 · 09.11» */
export function zeroText(d: Diary, rifleId: string, scopeId: string, withDate = true): string {
  const zero = zeroInfo(d, rifleId, scopeId);
  if (!zero) return 'ноль не отмечен';
  if (zero.derived) return `ноль ${zero.dist} м, по журналу`;
  const ammo = zero.ammoId ? ` под ${ammoName(ammoById(d, zero.ammoId))}` : '';
  return `ноль ${zero.dist} м${ammo}${withDate ? ` · ${shortDate(zero.date)}` : ''}`;
}

/** Whether series `si` of this session was fired after the zero was set. */
export function afterZero(s: Session, si: number, zero: ZeroInfo | null): boolean {
  if (!zero || zero.derived) return true;
  if (s.id === zero.sessionId) return si > (zero.afterSi as number);
  const byDate = (s.date || '').localeCompare(zero.date as string);
  return (byDate || s.createdAt.localeCompare(zero.createdAt as string)) > 0;
}

/** For each distance the latest usable series wins, so sessions are read oldest first. */
export function dopePoints(
  d: Diary,
  rifleId: string,
  scopeId: string,
  ammoId: string | null | undefined,
  device = '*',
  rest = '*',
): DopePoints {
  const zero = zeroInfo(d, rifleId, scopeId);
  const normalSeries = (s: Session) =>
    s.series.flatMap((x, si) =>
      x.kind === 'normal' && seriesMatches(x, ammoId, device, rest, scopeId) ? [{ x, si }] : [],
    );
  const elev = new Map<number, Omit<DopePoint, 'd'>>();
  const wind = new Map<number, Omit<WindPoint, 'd'>>();
  const used = new Set<string>();
  const temps: number[] = [];
  let before = 0;
  for (const s of sessionsOf(d, rifleId, ammoId).reverse()) {
    const entries = normalSeries(s);
    if (!entries.length) continue;
    const current = entries.filter(({ si }) => afterZero(s, si, zero));
    if (!current.length) before++;
    for (const { x } of current) {
      if (!seriesStatus(x).use) continue;
      const dist = x.dist as number;
      elev.set(dist, {
        v: elevEff(x) as number,
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
  return { elev: sorted(elev), wind: sorted(wind), sessions: used.size, temps, before, zero };
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

/** The requested scope if the rifle has it, else the mounted one, else any. */
export function cardScopeId(
  d: Diary,
  rifle: Rifle,
  current: string | null | undefined,
): string | null {
  const live = rifle.mounts.filter((m) => scopeById(d, m.scopeId));
  if (current && live.some((m) => m.scopeId === current)) return current;
  return (live.find((m) => m.mounted) ?? live[0])?.scopeId ?? null;
}

/** The requested ammo if the rifle has it, else the first one with data. */
export function cardAmmoId(
  d: Diary,
  rifle: Rifle,
  scopeId: string,
  current: string | null | undefined,
  device = '*',
  rest = '*',
): string | null {
  const combos = combosOf(d, rifle);
  if (!combos.length) return null;
  if (current && combos.some((c) => c.ammoId === current)) return current;
  const withData = combos.find(
    (c) => dopePoints(d, rifle.id, scopeId, c.ammoId, device, rest).elev.length,
  );
  return (withData ?? combos[0]).ammoId;
}

export function cardRows(
  d: Diary,
  rifle: Rifle,
  scopeId: string,
  ammoId: string | null | undefined,
  options: CardOptions,
): CardData {
  const { step, device = '*', rest = '*' } = options;
  const scope = scopeById(d, scopeId);
  const ammo = ammoById(d, ammoId);
  const combo = comboOf(d, rifle, ammoId);
  const points = dopePoints(d, rifle.id, scopeId, ammoId, device, rest);
  if (!ammo || !points.elev.length) return { rifle, scope, ammo, combo, points, rows: [] };

  const units = scope?.units ?? 'MRAD';
  const inUnits = (p: Interpolated): Interpolated => ({ ...p, v: toUnits(p.v, units) });
  const from = options.from ?? points.elev[0].d;
  const to = options.to ?? points.elev[points.elev.length - 1].d;
  const dists = new Set<number>();
  for (let dist = Math.ceil(from / step) * step; dist <= to; dist += step) dists.add(dist);
  for (const p of points.elev) if (p.d >= from && p.d <= to) dists.add(p.d);

  const rows = [...dists]
    .sort((a, b) => a - b)
    .flatMap((dist): CardRow[] => {
      const found = interp(points.elev, dist);
      if (!found) return [];
      const e = inUnits(found);
      const w = interp(points.wind, dist);
      const clicks = scope?.click ? Math.round(e.v / scope.click) : null;
      return [{ d: dist, e, w: w && inUnits(w), clicks }];
    });
  return { rifle, scope, ammo, combo, points, rows };
}

/** The ammo's correction at the distance this scope is zeroed at, mrad. */
export function offsetAtZero(
  d: Diary,
  rifleId: string,
  scopeId: string,
  ammoId: string,
): number | null {
  const zero = zeroInfo(d, rifleId, scopeId);
  if (!zero) return null;
  return dopePoints(d, rifleId, scopeId, ammoId).elev.find((p) => p.d === zero.dist)?.v ?? null;
}

const usedValues = (
  d: Diary,
  rifleId: string,
  ammoId: string | null | undefined,
  scopeId: string | null | undefined,
  pick: (x: { device?: string; rest?: string }) => string | undefined,
): string[] => [
  ...new Set(
    sessionsOf(d, rifleId, ammoId)
      .flatMap((s) => seriesFor(s, ammoId, '*', '*', scopeId))
      .filter((x) => seriesStatus(x).use)
      .map((x) => pick(x) || ''),
  ),
];

export const devicesUsed = (
  d: Diary,
  rifleId: string,
  ammoId?: string | null,
  scopeId?: string | null,
): string[] => usedValues(d, rifleId, ammoId, scopeId, (x) => x.device);

export const restsUsed = (
  d: Diary,
  rifleId: string,
  ammoId?: string | null,
  scopeId?: string | null,
): string[] => usedValues(d, rifleId, ammoId, scopeId, (x) => x.rest);

/** Average vertical offset per rest (2+ series each) in mrad, when rests differ noticeably. */
export function restShift(
  d: Diary,
  rifleId: string,
  scopeId: string,
  ammoId: string,
  device = '*',
): { rest: string; avg: number }[] | null {
  const byRest = new Map<string, number[]>();
  for (const s of sessionsOf(d, rifleId, ammoId)) {
    for (const x of seriesFor(s, ammoId, device, '*', scopeId)) {
      if (!seriesStatus(x).use || x.offUp == null || !((x.dist ?? 0) > 0)) continue;
      const key = x.rest || '';
      byRest.set(key, [...(byRest.get(key) ?? []), x.offUp / (x.dist as number)]);
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
  return spread >= ZERO_TOLERANCE ? rows : null;
}

export function zeroNotes(ammo: Ammo | null, points: DopePoints, units: ScopeUnits): CardNote[] {
  const zero = points.zero;
  const notes: CardNote[] = [];
  if (!zero) {
    notes.push({
      kind: 'warn',
      text: 'Пристрелка не отмечена. Отметьте в записи стрельбы, когда выставляли ноль.',
    });
  } else if (!zero.derived && points.before) {
    notes.push({
      kind: 'hint',
      text: `Не учтено ${points.before} стр. до пристрелки ${rdate(zero.date)}: тогда ноль был другим.`,
    });
  }
  if (zero && !zero.derived && ammo?.id === zero.ammoId) {
    const off = points.elev.find((p) => p.d === zero.dist);
    if (off && Math.abs(off.v) >= ZERO_TOLERANCE) {
      notes.push({
        kind: 'warn',
        text: `Патрону, под который пристрелян прицел, на ${zero.dist} м потребовалась поправка ${fmtSigned(toUnits(off.v, units))} ${unitLabel(units)}. Похоже, ноль сместился: проверьте крепление и при необходимости перепристреляйте.`,
      });
    }
  }
  return notes;
}
