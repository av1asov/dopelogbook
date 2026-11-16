import { ammoById, comboOf, mountsOf, scopeById, sessionsOf } from './diary';
import { afterZero, zeroInfo, ZeroInfo } from './dope';
import { shortDate } from './format';
import { Ammo, Combo, Diary, Rifle, Scope, Session, VelocitySource } from './model';
import { clickOf, elevEff, isStable, seriesMatches, seriesStatus, toMrad, unitsOf } from './series';
import {
  Atmosphere,
  BallisticInput,
  DEFAULT_HUMIDITY,
  estimateV0,
  ESTIMATE_ERROR,
  fitVelocity,
  FitPoint,
  mmHgToHpa,
  pressureAtAltitude,
  STANDARD_ATMOSPHERE,
  VelocityFit,
} from './solver';

/** Used when the mount has no height: a typical scope on rings over a rifle bore. */
export const DEFAULT_SIGHT_HEIGHT = 45;
/** Used when no zero is marked or derived from the journal. */
export const DEFAULT_ZERO = 100;

export interface V0Info {
  value: number;
  source: VelocitySource;
  /** YYYY-MM-DD, for a speed fitted from the journal. */
  date?: string;
  /** ± m/s, for an estimate from the box. */
  error?: number;
}

export interface BarrelInfo {
  length: number | null;
  twist: number | null;
  dir: 'R' | 'L';
}

const num = (text: string): number => parseFloat(text.replace(',', '.'));

/** Length and twist, read from the free text of older records when the fields are empty. */
export function barrelOf(rifle: Rifle | null | undefined): BarrelInfo {
  const text = rifle?.barrel ?? '';
  const length = text.match(/(\d{3})\s*мм/)?.[1];
  const twist =
    text.match(/1\s*[:/]\s*(\d+(?:[.,]\d+)?)/)?.[1] ??
    text.match(/(\d+(?:[.,]\d+)?)\s*(?:["″]|твист|дюйм)/i)?.[1];
  return {
    length: rifle?.barrelLength ?? (length ? num(length) : null),
    twist: rifle?.twist ?? (twist ? num(twist) : null),
    dir: rifle?.twistDir ?? 'R',
  };
}

/** Bullet diameters of common calibres, mm, matched against the start of the name. */
const CALIBRES: readonly (readonly [RegExp, number])[] = [
  [/^\.?(308|30-06|300|30)\b|^7[.,]62\s*[x×]\s*51/i, 7.82],
  [/^7[.,]62\s*[x×]\s*(39|54)|^\.?303\b/i, 7.92],
  [/^\.?(223|222|22-250)\b|^5[.,]56/i, 5.7],
  [/^5[.,]45/i, 5.6],
  [/^6[.,]5\b|^\.?(260|264)\b/i, 6.72],
  [/^\.?243\b|^6\s*mm|^6\s*мм/i, 6.17],
  [/^\.?338\b/i, 8.61],
  [/^9[.,]3\b/i, 9.3],
  [/^\.?22\b/i, 5.7],
];

export function caliberDiameter(caliber: string | null | undefined): number | null {
  const name = (caliber ?? '').trim();
  return CALIBRES.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export const bulletDiameterOf = (ammo: Ammo | null | undefined): number | null =>
  ammo?.bulletDiameterMm ?? caliberDiameter(ammo?.caliber);

/** V₀ of the combo; without a saved one, an estimate from the box and the barrel length. */
export function comboVelocity(
  rifle: Rifle | null | undefined,
  ammo: Ammo | null | undefined,
  combo: Combo | null | undefined,
): V0Info | null {
  if (combo?.velocity && combo.velocity > 0) {
    return {
      value: combo.velocity,
      source: combo.velocitySource ?? 'manual',
      ...(combo.velocityDate ? { date: combo.velocityDate } : {}),
    };
  }
  if (!ammo?.boxVelocity) return null;
  const estimate = estimateV0(
    {
      boxVelocity: ammo.boxVelocity,
      boxBarrelMm: ammo.boxBarrelMm,
      boxVelocityAt: ammo.boxVelocityAt,
    },
    barrelOf(rifle).length,
    { bc: ammo.bc, dragModel: ammo.dragModel },
  );
  return estimate
    ? { value: Math.round(estimate), source: 'estimate', error: ESTIMATE_ERROR }
    : null;
}

/** Rifle + scope + ammo, ready for the solver once the day's conditions are added. */
export interface CalcSetup {
  rifle: Rifle;
  scope: Scope | null;
  ammo: Ammo | null;
  combo: Combo | null;
  zero: ZeroInfo | null;
  zeroDist: number;
  sightHeight: number;
  /** The mount has no height; the default stands in for it. */
  sightAssumed: boolean;
  v0: V0Info | null;
  /** What keeps the table from being calculated. */
  missing: ('bc' | 'v0')[];
  /** Null while anything is missing. */
  base: Omit<BallisticInput, 'atmosphere'> | null;
}

export function calcSetup(
  d: Diary,
  rifle: Rifle,
  scopeId: string | null | undefined,
  ammoId: string | null | undefined,
): CalcSetup {
  const scope = scopeById(d, scopeId);
  const ammo = ammoById(d, ammoId);
  const combo = comboOf(d, rifle, ammoId);
  const mount = mountsOf(d, rifle).find((m) => m.scope.id === scopeId)?.mount;
  const zero = scope ? zeroInfo(d, rifle.id, scope.id) : null;
  const zeroDist = zero?.dist ?? DEFAULT_ZERO;
  const sightHeight = mount?.sightHeight ?? DEFAULT_SIGHT_HEIGHT;
  const v0 = comboVelocity(rifle, ammo, combo);
  const missing: CalcSetup['missing'] = [];
  if (!ammo?.bc) missing.push('bc');
  if (!v0) missing.push('v0');
  const barrel = barrelOf(rifle);
  const diameter = bulletDiameterOf(ammo);
  const base: CalcSetup['base'] =
    ammo?.bc && v0
      ? {
          dragModel: ammo.dragModel ?? 'G1',
          bc: ammo.bc,
          v0: v0.value,
          sightHeight,
          zeroDist,
          weightGr: ammo.bulletWeightGr ?? null,
          spin:
            barrel.twist && ammo.bulletWeightGr && diameter && ammo.bulletLengthMm
              ? {
                  twist: barrel.twist,
                  dir: barrel.dir,
                  weightGr: ammo.bulletWeightGr,
                  diameterMm: diameter,
                  lengthMm: ammo.bulletLengthMm,
                }
              : null,
        }
      : null;
  return {
    rifle,
    scope,
    ammo,
    combo,
    zero,
    zeroDist,
    sightHeight,
    sightAssumed: mount?.sightHeight == null,
    v0,
    missing,
    base,
  };
}

/** The air of a session; whatever was not written down is standard. */
export function sessionAtmosphere(s: Session): Atmosphere {
  const pressure =
    s.pressure != null && s.pressure > 0
      ? mmHgToHpa(s.pressure)
      : s.altitude != null
        ? pressureAtAltitude(s.altitude)
        : STANDARD_ATMOSPHERE.pressure;
  return { temp: s.temp ?? STANDARD_ATMOSPHERE.temp, pressure, humidity: DEFAULT_HUMIDITY };
}

/** The latest session with this rifle and ammo where the weather was written down. */
export function lastWeather(
  d: Diary,
  rifleId: string,
  ammoId: string | null | undefined,
): { session: Session; atmosphere: Atmosphere } | null {
  const session = sessionsOf(d, rifleId, ammoId).find(
    (s) => s.temp != null || s.pressure != null || s.altitude != null,
  );
  return session ? { session, atmosphere: sessionAtmosphere(session) } : null;
}

interface UsableSeries {
  session: Session;
  si: number;
  d: number;
  /** mrad */
  elev: number;
  hits: number;
}

/**
 * Series that tell where this combo really hits: normal, counted, from a stable position,
 * fired after the current zero of the scope.
 */
function usableSeries(
  d: Diary,
  rifleId: string,
  scopeId: string,
  ammoId: string,
  device = '*',
): UsableSeries[] {
  const zero = zeroInfo(d, rifleId, scopeId);
  return sessionsOf(d, rifleId, ammoId).flatMap((session) =>
    session.series.flatMap((x, si) => {
      if (x.kind !== 'normal' || !seriesMatches(x, ammoId, device, '*', scopeId)) return [];
      if (!seriesStatus(x).use || !isStable(x) || !afterZero(session, si, zero)) return [];
      const elev = elevEff(x);
      if (elev == null || !((x.dist ?? 0) > 0)) return [];
      return [{ session, si, d: x.dist as number, elev, hits: x.hits ?? x.shots ?? 1 }];
    }),
  );
}

/** Averaged by distance; mrad. */
export interface JournalPoint {
  d: number;
  elev: number;
  /** Highest minus lowest correction among the series, mrad. */
  spread: number;
  n: number;
}

export function journalPoints(
  d: Diary,
  rifleId: string,
  scopeId: string,
  ammoId: string,
  device = '*',
): JournalPoint[] {
  const byDist = new Map<number, number[]>();
  for (const s of usableSeries(d, rifleId, scopeId, ammoId, device)) {
    byDist.set(s.d, [...(byDist.get(s.d) ?? []), s.elev]);
  }
  return [...byDist.entries()]
    .map(([dist, values]) => ({
      d: dist,
      elev: values.reduce((sum, v) => sum + v, 0) / values.length,
      spread: Math.max(...values) - Math.min(...values),
      n: values.length,
    }))
    .sort((a, b) => a.d - b.d);
}

export interface FitRef {
  sessionId: string;
  si: number;
  date: string;
}

/** Every usable series, in its own day's weather, for fitting V₀. */
export function journalFitPoints(
  d: Diary,
  rifleId: string,
  scopeId: string,
  ammoId: string,
  device = '*',
): FitPoint[] {
  return usableSeries(d, rifleId, scopeId, ammoId, device).map((s) => ({
    d: s.d,
    elev: s.elev,
    weight: Math.max(1, s.hits),
    atmosphere: sessionAtmosphere(s.session),
    ref: { sessionId: s.session.id, si: s.si, date: s.session.date } satisfies FitRef,
  }));
}

/** V₀ that fits this combo's journal, or null without a BC or series at 200 m and further. */
export function journalVelocity(d: Diary, setup: CalcSetup, device = '*'): VelocityFit | null {
  const { rifle, scope, ammo, base } = setup;
  if (!scope || !ammo?.bc) return null;
  const points = journalFitPoints(d, rifle.id, scope.id, ammo.id, device);
  const fitBase = {
    dragModel: ammo.dragModel ?? 'G1',
    bc: ammo.bc,
    sightHeight: setup.sightHeight,
    zeroDist: setup.zeroDist,
    spin: base?.spin ?? null,
  };
  const click = toMrad(clickOf(scope), unitsOf(scope));
  return fitVelocity(fitBase, points, click, setup.v0?.value ?? 800);
}

/** What the fit offers: a new speed, an update, or nothing worth showing. */
export type FitOffer = 'accept' | 'update' | null;

/**
 * Offer a fitted V₀ in place of an estimate, or in place of an earlier fit that it now
 * differs from by more than its error. A speed typed in by hand is never replaced.
 */
export function fitOffer(v0: V0Info | null, fit: VelocityFit | null): FitOffer {
  if (!fit || !isFinite(fit.error)) return null;
  if (!v0 || v0.source === 'estimate') return 'accept';
  if (v0.source === 'journal' && Math.abs(fit.v0 - v0.value) > fit.error) return 'update';
  return null;
}

/** «оценка ±20», «по журналу, 16.11», «вручную»: shown next to V₀ everywhere. */
export function velocitySourceText(v0: V0Info): string {
  switch (v0.source) {
    case 'estimate':
      return `оценка ±${v0.error ?? ESTIMATE_ERROR}`;
    case 'journal':
      return v0.date ? `по журналу, ${shortDate(v0.date)}` : 'по журналу';
    case 'manual':
      return 'вручную';
  }
}
