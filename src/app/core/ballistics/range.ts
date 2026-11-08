import { sessionsOf } from './diary';
import { zeroInfo } from './dope';
import { Diary, Rifle, Series } from './model';

export type SeriesDefaults = Pick<
  Series,
  'ammoId' | 'device' | 'pos' | 'rest' | 'dist' | 'elev' | 'shots'
>;

const DEFAULT_SHOTS = 5;

/** The first series of a session starts from the last series fired with this rifle. */
export function firstSeriesDefaults(d: Diary, rifle: Rifle): SeriesDefaults {
  const previous = sessionsOf(d, rifle.id)
    .find((s) => s.series.length)
    ?.series.at(-1);
  const stillLinked = previous && rifle.combos.some((c) => c.ammoId === previous.ammoId);
  return {
    ammoId: stillLinked ? previous.ammoId : (rifle.combos[0]?.ammoId ?? ''),
    device: previous?.device ?? '',
    pos: previous?.pos ?? '',
    rest: previous?.rest ?? '',
    dist: zeroInfo(d, rifle.id)?.dist ?? 100,
    elev: 0,
    shots: DEFAULT_SHOTS,
  };
}

export function nextSeriesDefaults(previous: Series): SeriesDefaults {
  return {
    ammoId: previous.ammoId,
    device: previous.device ?? '',
    pos: previous.pos ?? '',
    rest: previous.rest ?? '',
    dist: previous.dist ?? null,
    elev: previous.elev ?? null,
    shots: previous.shots ?? DEFAULT_SHOTS,
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
