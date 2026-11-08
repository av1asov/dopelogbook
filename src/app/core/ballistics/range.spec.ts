import { Diary, Rifle, Session } from './model';
import { altitudeAt, firstSeriesDefaults, nextSeriesDefaults, recentPlaces } from './range';
import { exampleDiary, FACTORY, HAND, rifle } from './testing/example-diary';

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
