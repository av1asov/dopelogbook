import { Diary, Rifle, Session } from './model';
import {
  altitudeAt,
  barrelRounds,
  cardUpdates,
  firstSeriesDefaults,
  nextSeriesDefaults,
  recentPlaces,
  zeroingDefaults,
} from './range';
import { exampleDiary, FACTORY, HAND, rifle, SCOPE } from './testing/example-diary';

const stamp = '2026-01-01T00:00:00.000Z';
const session = (id: string, date: string, extra: Partial<Session> = {}): Session => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  rifleId: rifle.id,
  date,
  series: [],
  ...extra,
});

describe('firstSeriesDefaults', () => {
  it('continues from the last series fired, at the zero distance', () => {
    expect(firstSeriesDefaults(exampleDiary, rifle)).toEqual({
      scopeId: SCOPE,
      ammoId: FACTORY,
      device: 'Глушитель',
      pos: 'sit',
      rest: 'bench',
      dist: 100,
      elev: 0,
      shots: 5,
    });
  });

  it('skips a session with no series yet', () => {
    const d: Diary = {
      ...exampleDiary,
      sessions: [...exampleDiary.sessions, session('open', '2026-12-01', { open: true })],
    };
    expect(firstSeriesDefaults(d, rifle).ammoId).toBe(FACTORY);
  });

  it('falls back to the first linked ammo', () => {
    const relinked: Rifle = { ...rifle, combos: [{ ammoId: HAND }] };
    expect(firstSeriesDefaults(exampleDiary, relinked).ammoId).toBe(HAND);
  });

  it('starts at 100 m with no history', () => {
    const d: Diary = { ...exampleDiary, sessions: [] };
    expect(firstSeriesDefaults(d, rifle)).toMatchObject({ ammoId: HAND, dist: 100, elev: 0 });
  });
});

describe('nextSeriesDefaults', () => {
  it('copies ammo, device, stance, distance and elevation but not the result', () => {
    expect(
      nextSeriesDefaults({
        kind: 'normal',
        scopeId: SCOPE,
        ammoId: HAND,
        device: 'ДТК',
        pos: 'prone',
        rest: 'bipod',
        dist: 300,
        elev: 2,
        shots: 3,
        hits: 2,
        group: 90,
        offUp: 10,
        windSpeed: 2,
        windCorr: 0.3,
      }),
    ).toEqual({
      scopeId: SCOPE,
      ammoId: HAND,
      device: 'ДТК',
      pos: 'prone',
      rest: 'bipod',
      dist: 300,
      elev: 2,
      shots: 3,
    });
  });
});

describe('after zeroing', () => {
  it('starts a control group on the zero with a full series', () => {
    expect(
      nextSeriesDefaults({ kind: 'zeroing', scopeId: SCOPE, ammoId: HAND, dist: 100, shots: 3 }),
    ).toMatchObject({ dist: 100, elev: 0, shots: 5, scopeId: SCOPE });
  });
});

describe('zeroingDefaults', () => {
  it('uses the mounted scope, its zero distance and zeroed ammo', () => {
    expect(zeroingDefaults(exampleDiary, rifle)).toEqual({
      dist: 100,
      ammoId: HAND,
      scopeId: SCOPE,
    });
  });
});

describe('places', () => {
  const d: Diary = {
    ...exampleDiary,
    sessions: [
      session('a', '2026-01-01', { place: 'Старое', altitude: 100 }),
      session('b', '2026-02-01', { place: 'Калибр', altitude: 160 }),
      session('c', '2026-03-01', { place: 'Калибр' }),
      session('d', '2026-04-01', { place: 'Полигон' }),
    ],
  };

  it('lists distinct places, newest first', () => {
    expect(recentPlaces(d)).toEqual(['Полигон', 'Калибр', 'Старое']);
    expect(recentPlaces(d, 1)).toEqual(['Полигон']);
  });

  it('finds the last known altitude of a place', () => {
    expect(altitudeAt(d, 'Калибр')).toBe(160);
    expect(altitudeAt(d, 'Полигон')).toBeNull();
  });
});

describe('cardUpdates', () => {
  const series = (x: Partial<Session['series'][number]>) => ({
    kind: 'normal' as const,
    scopeId: SCOPE,
    ammoId: HAND,
    device: 'ДТК',
    pos: 'prone' as const,
    rest: 'bipod' as const,
    hits: 5,
    shots: 5,
    ...x,
  });

  it('names the distances the new session now gives to each card', () => {
    const today = session('today', '2026-11-08', {
      series: [
        series({ dist: 100, elev: 0 }),
        series({ dist: 200, elev: 0.9 }),
        series({ dist: 200, elev: 1.0 }),
        series({ ammoId: FACTORY, dist: 300, elev: 2.4 }),
        series({ dist: 400, elev: 3.0, skip: true }),
        { kind: 'zeroing' as const, scopeId: SCOPE, ammoId: HAND, shots: 3 },
      ],
    });
    expect(cardUpdates(exampleDiary, today)).toEqual([
      { ammoId: HAND, scopeId: SCOPE, dists: [100, 200] },
      { ammoId: FACTORY, scopeId: SCOPE, dists: [300] },
    ]);
  });

  it('gives nothing for series that do not reach the card', () => {
    const today = session('today', '2026-11-08', {
      series: [series({ dist: 100, elev: null }), series({ dist: 200, elev: 1, hits: 0 })],
    });
    expect(cardUpdates(exampleDiary, today)).toEqual([]);
  });

  it('skips a point a later session already gives', () => {
    const old = session('old', '2026-01-05', { series: [series({ dist: 400, elev: 3 })] });
    expect(cardUpdates(exampleDiary, old)).toEqual([]);
  });
});

describe('barrelRounds', () => {
  it('counts every session of the rifle, the given one as it is', () => {
    const before = barrelRounds(exampleDiary, session('none', '2026-11-08'));
    const today = session('today', '2026-11-08', {
      series: [{ kind: 'zeroing', scopeId: SCOPE, ammoId: HAND, shots: 3 }],
      extraRounds: 2,
    });
    expect(barrelRounds(exampleDiary, today)).toBe(before + 5);
    expect(barrelRounds(exampleDiary, { ...today, id: 's3' })).toBe(
      before + 5 - (5 + 3 + 3 + 3 + 1),
    );
  });
});
