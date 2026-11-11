import { mainScope, sessionsOf } from './diary';
import { afterZero, dopePoints, zeroInfo } from './dope';
import { Diary, Rifle, Series, Session, ZeroingPlan } from './model';
import { elevEff, seriesStatus, sessionRounds } from './series';

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

/** Distances of one DOPE card that a session now supplies. */
export interface CardUpdate {
  ammoId: string;
  scopeId: string;
  dists: number[];
}

/** The diary with `session` in place of its stored copy, or added to it. */
export function withSession(d: Diary, session: Session): Diary {
  const others = d.sessions.filter((s) => s.id !== session.id);
  return { ...d, sessions: [...others, session] };
}

/**
 * The card points the session gives, card by card in the order of its series: those where its
 * series, rather than an older or a later one, is now the point of the card.
 */
export function cardUpdates(d: Diary, session: Session): CardUpdate[] {
  const diary = withSession(d, session);
  const cards = new Map<string, CardUpdate>();
  session.series.forEach((x) => {
    if (!seriesStatus(x).use) return;
    const key = `${x.ammoId}|${x.scopeId}`;
    if (!cards.has(key)) cards.set(key, { ammoId: x.ammoId, scopeId: x.scopeId, dists: [] });
  });
  return [...cards.values()].flatMap((card) => {
    const zero = zeroInfo(diary, session.rifleId, card.scopeId);
    const latest = new Map<number, number>();
    session.series.forEach((x, si) => {
      const same = x.ammoId === card.ammoId && x.scopeId === card.scopeId;
      if (same && seriesStatus(x).use && afterZero(session, si, zero)) {
        latest.set(x.dist as number, elevEff(x) as number);
      }
    });
    const points = dopePoints(diary, session.rifleId, card.scopeId, card.ammoId).elev;
    const dists = points
      .filter((p) => p.date === session.date && latest.get(p.d) === p.v)
      .map((p) => p.d);
    return dists.length ? [{ ...card, dists }] : [];
  });
}

/** Rounds through the barrel over all its sessions, `session` taken as it is given. */
export function barrelRounds(d: Diary, session: Session): number {
  return sessionsOf(withSession(d, session), session.rifleId).reduce(
    (sum, s) => sum + sessionRounds(s),
    0,
  );
}
