import {
  ammoName,
  cardAmmoId,
  cardRows,
  coldStats,
  Diary,
  elevEff,
  fmt,
  fmtAng,
  interp,
  offText,
  parseNum,
  seriesGroupAng,
  seriesStatus,
  Session,
  sessionRounds,
  zeroInfo,
  zeroNotes,
} from './index';
import { exampleDiary as diary, FACTORY, HAND, rifle, RIFLE } from './testing/example-diary';
import golden from './testing/example.golden.json';
import { goldenSnapshot } from './testing/golden-snapshot';

describe('matches the original diary on its example data', () => {
  const actual = goldenSnapshot(diary, { rifle: RIFLE, hand: HAND, factory: FACTORY });

  for (const key of Object.keys(golden)) {
    it(key, () => {
      expect(actual[key]).toEqual((golden as Record<string, unknown>)[key]);
    });
  }
});

describe('elevEff', () => {
  it('500 m: 4.5 MIL with the group 50 mm low gives 4.6 MIL', () => {
    expect(elevEff({ ammoId: HAND, dist: 500, elev: 4.5, offUp: -50 }, 'MIL')).toBeCloseTo(4.6, 9);
  });

  it('converts the correction to MOA', () => {
    expect(elevEff({ ammoId: HAND, dist: 100, elev: 10, offUp: 100 }, 'MOA')).toBeCloseTo(
      10 - 3.4377,
      9,
    );
  });

  it('returns the raw elevation without a group centre', () => {
    expect(elevEff({ ammoId: HAND, dist: 300, elev: 2 }, 'MIL')).toBe(2);
    expect(elevEff({ ammoId: HAND, dist: 300 }, 'MIL')).toBeNull();
  });
});

describe('seriesStatus', () => {
  const base = { ammoId: HAND, dist: 100, elev: 0 };

  it('accepts a series with hits', () => {
    expect(seriesStatus({ ...base, hits: 3, shots: 5 }).use).toBe(true);
  });

  it('marks a manually skipped series', () => {
    expect(seriesStatus({ ...base, skip: true })).toEqual({
      use: false,
      why: 'исключена вручную',
      manual: true,
    });
  });

  it('requires distance and elevation', () => {
    expect(seriesStatus({ ammoId: HAND, elev: 0 }).use).toBe(false);
    expect(seriesStatus({ ammoId: HAND, dist: 100 }).use).toBe(false);
  });

  it('rejects all misses unless the group centre is recorded', () => {
    expect(seriesStatus({ ...base, hits: 0, shots: 3 }).use).toBe(false);
    expect(seriesStatus({ ...base, hits: 0, shots: 3, offUp: 10 }).use).toBe(true);
  });
});

describe('cold shot', () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const session = (series: Session['series'], coldShot: Session['coldShot']): Session => ({
    id: 'x',
    createdAt: stamp,
    updatedAt: stamp,
    rifleId: RIFLE,
    date: '2026-11-08',
    series,
    coldShot,
  });

  it('leaves its series in the card', () => {
    const s = session([{ ammoId: HAND, dist: 100, elev: 0, hits: 5, shots: 5 }], {
      si: 0,
      offUp: 20,
    });
    expect(seriesStatus(s.series[0]).use).toBe(true);
  });

  it('does not count towards the group size', () => {
    const series = [{ ammoId: HAND, dist: 100, shots: 3, group: 30 }];
    expect(seriesGroupAng(session(series, { si: 0, offUp: 20 }), 0)).toBeNull();
    expect(seriesGroupAng(session(series, null), 0)).toBeCloseTo(0.3, 9);
  });

  it('is already included in the shots of its series', () => {
    const s = session([{ ammoId: HAND, dist: 100, shots: 5 }], { si: 0, offUp: 20 });
    expect(sessionRounds(s)).toBe(5);
  });

  it('uses the distance of its series', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session([{ ammoId: HAND, dist: 200, shots: 5 }], { si: 0, offUp: 20, offRight: 10 }),
      ],
    };
    expect(coldStats(d, RIFLE)).toEqual({ n: 1, up: 0.1, right: 0.05 });
  });
});

describe('zero', () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const session = (id: string, date: string, extra: Partial<Session>): Session => ({
    id,
    createdAt: stamp,
    updatedAt: stamp,
    rifleId: RIFLE,
    date,
    series: [],
    ...extra,
  });
  const point = (dist: number, elev: number) => ({ ammoId: HAND, dist, elev, hits: 3, shots: 3 });

  it('derives the zero from the most frequent zero elevation', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session('a', '2026-01-01', { series: [point(100, 0), point(100, 0), point(50, 0)] }),
      ],
    };
    expect(zeroInfo(d, RIFLE)).toEqual({ dist: 100, derived: true });
  });

  it('ignores sessions before the latest re-zero and warns about them', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session('old', '2026-01-01', { series: [point(300, 9)] }),
        session('new', '2026-02-01', {
          rezero: { dist: 100, ammoId: HAND },
          series: [point(100, 0), point(200, 1)],
        }),
      ],
    };
    const { points, rows } = cardRows(d, rifle, HAND, { step: 100 });
    expect(rows.map((r) => r.d)).toEqual([100, 200]);
    expect(points.before).toBe(1);
    expect(zeroNotes(null, points, 'MIL')).toEqual([
      { kind: 'hint', text: 'Не учтено 1 стр. до пристрелки 01.02.2026: тогда ноль был другим.' },
    ]);
  });

  it('warns when the zeroed ammo needs a correction at the zero distance', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session('z', '2026-02-01', {
          rezero: { dist: 100, ammoId: HAND },
          series: [point(100, 0.3)],
        }),
      ],
    };
    const { ammo, points } = cardRows(d, rifle, HAND, { step: 100 });
    expect(zeroNotes(ammo, points, 'MIL').map((n) => n.kind)).toEqual(['warn']);
  });
});

describe('interp', () => {
  const points = [
    { d: 100, v: 0 },
    { d: 300, v: 2 },
  ];

  it('returns measured points as exact', () => {
    expect(interp(points, 300)).toEqual({ v: 2, exact: true });
  });

  it('interpolates between points', () => {
    expect(interp(points, 200)).toEqual({ v: 1, exact: false });
  });

  it('does not extrapolate', () => {
    expect(interp(points, 50)).toBeNull();
    expect(interp(points, 400)).toBeNull();
    expect(interp([], 100)).toBeNull();
  });
});

describe('cardAmmoId', () => {
  it('keeps the requested ammo', () => {
    expect(cardAmmoId(diary, rifle, FACTORY)).toBe(FACTORY);
  });

  it('falls back to the first ammo with data', () => {
    expect(cardAmmoId(diary, rifle, 'unknown')).toBe(HAND);
  });
});

describe('format', () => {
  it('reads both decimal separators', () => {
    expect(parseNum('4,5')).toBe(4.5);
    expect(parseNum('4.5')).toBe(4.5);
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
  });

  it('writes a decimal comma', () => {
    expect(fmt(4.56, 1)).toBe('4,6');
    expect(fmt(null)).toBe('—');
  });

  it('formats angles in the chosen unit', () => {
    expect(fmtAng(1, 'MIL')).toBe('1,00 MIL');
    expect(fmtAng(1, 'MOA')).toBe('3,44 MOA');
    expect(fmtAng(null, 'MOA')).toBe('—');
  });

  it('describes the group centre', () => {
    expect(offText({ ammoId: HAND, dist: 100, offUp: 20, offRight: -10 }, 'MIL')).toBe(
      '↑0,20 ←0,10 MIL',
    );
    expect(offText({ ammoId: HAND, dist: 100, offUp: 0 }, 'MIL')).toBe('в центре');
    expect(offText({ ammoId: HAND, dist: 100 }, 'MIL')).toBe('');
  });

  it('names ammo', () => {
    expect(ammoName(diary.ammo[0])).toBe('Тренировочный 175');
    expect(ammoName(diary.ammo[1])).toBe('Sellier & Bellot SPCE');
    expect(ammoName(null)).toBe('—');
  });
});
