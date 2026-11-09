import { mainScope, sessionsOf } from './diary';
import { zeroInfo } from './dope';
import { Diary, Rifle, Series, ZeroingPlan } from './model';

export type SeriesDefaults = Pick<
  Series,
  'scopeId' | 'ammoId' | 'device' | 'pos' | 'rest' | 'dist' | 'elev' | 'shots'
>;

const DEFAULT_SHOTS = 5;

/** The first series of a session starts from the last series fired with this rifle. */
export function firstSeriesDefaults(d: Diary, rifle: Rifle): SeriesDefaults {
  const previous = sessionsOf(d, rifle.id)
    .find((s) => s.series.length)
    ?.series.at(-1);
  const stillLinked = previous && rifle.combos.some((c) => c.ammoId === previous.ammoId);
  const scopeId = mainScope(d, rifle)?.id ?? '';
  return {
    scopeId,
    ammoId: stillLinked ? previous.ammoId : (rifle.combos[0]?.ammoId ?? ''),
    device: previous?.device ?? '',
    pos: previous?.pos ?? '',
    rest: previous?.rest ?? '',
    dist: zeroInfo(d, rifle.id, scopeId)?.dist ?? 100,
    elev: 0,
    shots: DEFAULT_SHOTS,
  };
}

/** After zeroing comes a control group: on the zero, with a full series. */
export function nextSeriesDefaults(previous: Series): SeriesDefaults {
  const zeroing = previous.kind === 'zeroing';
  return {
    scopeId: previous.scopeId,
    ammoId: previous.ammoId,
    device: previous.device ?? '',
    pos: previous.pos ?? '',
    rest: previous.rest ?? '',
    dist: previous.dist ?? null,
    elev: zeroing ? 0 : (previous.elev ?? null),
    shots: zeroing ? DEFAULT_SHOTS : (previous.shots ?? DEFAULT_SHOTS),
  };
}

/** The mounted scope at its current zero distance, with the ammo it was zeroed for. */
export function zeroingDefaults(d: Diary, rifle: Rifle): ZeroingPlan {
  const scopeId = mainScope(d, rifle)?.id ?? '';
  const zero = zeroInfo(d, rifle.id, scopeId);
  const linked = rifle.combos.some((c) => c.ammoId === zero?.ammoId);
  return {
    dist: zero?.dist ?? 100,
    ammoId: linked ? (zero?.ammoId as string) : firstSeriesDefaults(d, rifle).ammoId,
    scopeId,
  };
}

/** Distinct places, most recent first. */
export function recentPlaces(d: Diary, limit = 3): string[] {
  const places = sessionsOf(d).flatMap((s) => (s.place ? [s.place] : []));
  return [...new Set(places)].slice(0, limit);
}

/** Altitude recorded the last time at this place. */
export function altitudeAt(d: Diary, place: string): number | null {
  const session = sessionsOf(d).find((s) => s.place === place && s.altitude != null);
  return session?.altitude ?? null;
}
