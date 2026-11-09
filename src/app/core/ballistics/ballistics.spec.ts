import {
  ammoName,
  cardAmmoId,
  cardRows,
  coldStats,
  Diary,
  elevEff,
  fmt,
  fmtAng,
  finishZeroing,
  groupsOf,
  interp,
  offText,
  parseNum,
  seriesGroupAng,
  seriesStatus,
  Series,
  Session,
  sessionRounds,
  barrelLife,
  toMrad,
  toUnits,
  unitDigits,
  unitLabel,
  zeroInfo,
  zeroNotes,
} from './index';
import {
  exampleDiary as diary,
  FACTORY,
  HAND,
  rifle,
  RIFLE,
  scope,
  SCOPE,
} from './testing/example-diary';
import golden from './testing/example.golden.json';
import { goldenSnapshot } from './testing/golden-snapshot';

const normal = (x: Partial<Series>): Series => ({
  kind: 'normal',
  scopeId: SCOPE,
  ammoId: HAND,
  ...x,
});

describe('matches the original diary on its example data', () => {
  const actual = goldenSnapshot(diary, { rifle: RIFLE, hand: HAND, factory: FACTORY });

  for (const key of Object.keys(golden)) {
    it(key, () => {
      expect(actual[key]).toEqual((golden as Record<string, unknown>)[key]);
    });
  }
});

describe('elevEff', () => {
  it('500 m: 4.5 mrad with the group 50 mm low gives 4.6 mrad', () => {
    expect(elevEff({ dist: 500, elev: 4.5, offUp: -50 })).toBeCloseTo(4.6, 9);
  });

  it('returns the raw elevation without a group centre', () => {
    expect(elevEff({ dist: 300, elev: 2 })).toBe(2);
    expect(elevEff({ dist: 300 })).toBeNull();
  });
});

describe('seriesStatus', () => {
  const base = { dist: 100, elev: 0 };

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
    expect(seriesStatus({ elev: 0 }).use).toBe(false);
    expect(seriesStatus({ dist: 100 }).use).toBe(false);
  });

  it('rejects all misses unless the group centre is recorded', () => {
    expect(seriesStatus({ ...base, hits: 0, shots: 3 }).use).toBe(false);
    expect(seriesStatus({ ...base, hits: 0, shots: 3, offUp: 10 }).use).toBe(true);
  });

  it('never takes a zeroing series', () => {
    expect(seriesStatus({ ...base, kind: 'zeroing', hits: 3, shots: 3 }).use).toBe(false);
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
    const s = session([normal({ dist: 100, elev: 0, hits: 5, shots: 5 })], {
      si: 0,
      offUp: 20,
    });
    expect(seriesStatus(s.series[0]).use).toBe(true);
  });

  it('does not count towards the group size', () => {
    const series = [normal({ dist: 100, shots: 3, group: 30 })];
    expect(seriesGroupAng(session(series, { si: 0, offUp: 20 }), 0)).toBeNull();
    expect(seriesGroupAng(session(series, null), 0)).toBeCloseTo(0.3, 9);
  });

  it('is already included in the shots of its series', () => {
    const s = session([normal({ dist: 100, shots: 5 })], { si: 0, offUp: 20 });
    expect(sessionRounds(s)).toBe(5);
  });

  it('uses the distance of its series', () => {
    const d: Diary = {
      ...diary,
      sessions: [session([normal({ dist: 200, shots: 5 })], { si: 0, offUp: 20, offRight: 10 })],
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
  const point = (dist: number, elev: number, scopeId = SCOPE) =>
    normal({ scopeId, dist, elev, hits: 3, shots: 3 });
  const zeroMark = (afterSi: number, scopeId = SCOPE) => ({
    afterSi,
    dist: 100,
    ammoId: HAND,
    scopeId,
  });

  it('derives the zero from the most frequent zero elevation', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session('a', '2026-01-01', { series: [point(100, 0), point(100, 0), point(50, 0)] }),
      ],
    };
    expect(zeroInfo(d, RIFLE, SCOPE)).toEqual({ dist: 100, derived: true });
  });

  it('ignores sessions before the latest re-zero and warns about them', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session('old', '2026-01-01', { series: [point(300, 9)] }),
        session('new', '2026-02-01', {
          zeroEvents: [zeroMark(-1)],
          series: [point(100, 0), point(200, 1)],
        }),
      ],
    };
    const { points, rows } = cardRows(d, rifle, SCOPE, HAND, { step: 100 });
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
          zeroEvents: [zeroMark(-1)],
          series: [point(100, 0.3)],
        }),
      ],
    };
    const { ammo, points } = cardRows(d, rifle, SCOPE, HAND, { step: 100 });
    expect(zeroNotes(ammo, points, 'MIL').map((n) => n.kind)).toEqual(['warn']);
  });

  it('draws the boundary at the series, not at the session', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session('z', '2026-02-01', {
          zeroEvents: [zeroMark(1)],
          series: [point(300, 9), point(400, 9), point(100, 0), point(200, 1)],
        }),
      ],
    };
    const { rows, points } = cardRows(d, rifle, SCOPE, HAND, { step: 100 });
    expect(rows.map((r) => r.d)).toEqual([100, 200]);
    expect(points.before).toBe(0);
  });

  it('counts later sessions in full and earlier ones not at all', () => {
    const d: Diary = {
      ...diary,
      sessions: [
        session('a', '2026-01-01', { series: [point(500, 9)] }),
        session('z', '2026-02-01', { zeroEvents: [zeroMark(0)], series: [point(300, 9)] }),
        session('b', '2026-03-01', { series: [point(100, 0)] }),
      ],
    };
    expect(cardRows(d, rifle, SCOPE, HAND, { step: 100 }).rows.map((r) => r.d)).toEqual([100]);
  });

  describe('two scopes on one rifle', () => {
    const THERMAL = 'thermal';
    const thermal = { ...scope, id: THERMAL, units: 'CM100' as const, click: 1 };
    const d: Diary = {
      ...diary,
      scopes: [scope, thermal],
      sessions: [
        session('old', '2026-01-01', {
          zeroEvents: [zeroMark(-1, SCOPE)],
          series: [point(100, 0), point(200, 1)],
        }),
        session('new', '2026-02-01', {
          zeroEvents: [{ ...zeroMark(0, THERMAL), dist: 50 }],
          series: [
            normal({ kind: 'zeroing', scopeId: THERMAL, dist: 50, shots: 3 }),
            point(50, 0, THERMAL),
            point(100, 0.5, THERMAL),
          ],
        }),
      ],
    };

    it('keeps a zero for each scope', () => {
      expect(zeroInfo(d, RIFLE, SCOPE)?.dist).toBe(100);
      expect(zeroInfo(d, RIFLE, THERMAL)?.dist).toBe(50);
    });

    it('re-zeroing the thermal leaves the card of the optic alone', () => {
      const card = cardRows(d, rifle, SCOPE, HAND, { step: 100 });
      expect(card.rows.map((r) => [r.d, r.e.v])).toEqual([
        [100, 0],
        [200, 1],
      ]);
      expect(card.points.before).toBe(0);
    });

    it('shows each card in the units of its scope, with clicks by its click value', () => {
      const card = cardRows(d, rifle, THERMAL, HAND, { step: 50 });
      expect(card.rows.map((r) => r.d)).toEqual([50, 100]);
      expect(card.rows[1].e.v).toBeCloseTo(5, 9);
      expect(card.rows[1].clicks).toBe(5);
    });

    it('shares barrel life between the scopes', () => {
      expect(barrelLife(d, RIFLE).at(-1)?.total).toBe(15);
    });

    it('filters groups by scope, showing all by default', () => {
      const withGroups: Diary = {
        ...d,
        sessions: [
          session('g', '2026-03-01', {
            series: [
              normal({ dist: 100, shots: 3, group: 30 }),
              normal({ dist: 100, shots: 3, group: 60, scopeId: THERMAL }),
            ],
          }),
        ],
      };
      expect(groupsOf(withGroups, RIFLE)).toHaveLength(2);
      expect(groupsOf(withGroups, RIFLE, null, THERMAL).map((g) => g.angle)).toEqual([0.6]);
    });
  });

  it('full zeroing run: only the control group and later reach the card, all shots the barrel', () => {
    const plan = { dist: 100, ammoId: HAND, scopeId: SCOPE };
    const zeroing = normal({ kind: 'zeroing', dist: 100, shots: 3, clicksUp: 2 });
    let s = session('z', '2026-02-01', { zeroing: plan, series: [zeroing] });
    s = finishZeroing(s, zeroing);
    expect(s.zeroEvents).toEqual([{ afterSi: 1, ...plan }]);
    s = { ...s, series: [...s.series, point(100, 0), point(300, 2)] };
    const d: Diary = {
      ...diary,
      sessions: [session('old', '2026-01-01', { series: [point(500, 9)] }), s],
    };
    expect(cardRows(d, rifle, SCOPE, HAND, { step: 100 }).rows.map((r) => r.d)).toEqual([
      100, 200, 300,
    ]);
    expect(sessionRounds(s)).toBe(12);
    expect(groupsOf(d, RIFLE)).toHaveLength(0);
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
    expect(cardAmmoId(diary, rifle, SCOPE, FACTORY)).toBe(FACTORY);
  });

  it('falls back to the first ammo with data', () => {
    expect(cardAmmoId(diary, rifle, SCOPE, 'unknown')).toBe(HAND);
  });
});

describe('units', () => {
  it('converts to mrad', () => {
    expect(toMrad(1, 'MOA')).toBeCloseTo(0.2909, 4);
    expect(toMrad(1, 'CM100')).toBeCloseTo(0.1, 9);
    expect(toMrad(1, 'MM100')).toBeCloseTo(0.01, 9);
    expect(toMrad(1, 'MIL')).toBe(1);
    expect(toMrad(1, 'MRAD')).toBe(1);
  });

  it('converts back', () => {
    expect(toUnits(toMrad(23, 'CM100'), 'CM100')).toBeCloseTo(23, 9);
    expect(toUnits(toMrad(10.25, 'MOA'), 'MOA')).toBeCloseTo(10.25, 9);
  });

  it('labels units as the scope has them', () => {
    expect(unitLabel('MRAD')).toBe('MRAD');
    expect(unitLabel('CM100')).toBe('см/100 м');
  });

  it('shows as many decimals as a click needs', () => {
    expect(unitDigits(scope)).toBe(1);
    expect(unitDigits({ ...scope, units: 'MOA', click: 0.25 })).toBe(2);
    expect(unitDigits({ ...scope, units: 'CM100', click: 1 })).toBe(0);
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
    expect(fmtAng(1, 'MRAD')).toBe('1,00 MRAD');
    expect(fmtAng(1, 'MOA')).toBe('3,44 MOA');
    expect(fmtAng(null, 'MOA')).toBe('—');
  });

  it('describes the group centre', () => {
    expect(offText({ dist: 100, offUp: 20, offRight: -10 }, 'MIL')).toBe('↑0,20 ←0,10 MIL');
    expect(offText({ dist: 100, offUp: 0 }, 'MIL')).toBe('в центре');
    expect(offText({ dist: 100 }, 'MIL')).toBe('');
  });

  it('names ammo', () => {
    expect(ammoName(diary.ammo[0])).toBe('Тренировочный 175');
    expect(ammoName(diary.ammo[1])).toBe('Sellier & Bellot SPCE');
    expect(ammoName(null)).toBe('—');
  });
});
