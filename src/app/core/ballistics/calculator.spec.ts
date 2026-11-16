import {
  barrelOf,
  calcSetup,
  caliberDiameter,
  comboVelocity,
  Diary,
  fitOffer,
  journalFitPoints,
  journalPoints,
  lastWeather,
  sessionAtmosphere,
  Session,
  VelocityFit,
  velocitySourceText,
} from './index';
import {
  exampleDiary,
  FACTORY,
  HAND,
  rifle as exampleRifle,
  RIFLE,
  SCOPE,
} from './testing/example-diary';

const withBallistics: Diary = {
  ...exampleDiary,
  ammo: exampleDiary.ammo.map((a) =>
    a.id === HAND
      ? { ...a, bc: 0.243, dragModel: 'G7', bulletWeightGr: 175, bulletLengthMm: 31.5 }
      : { ...a, boxVelocity: 800, bc: 0.45 },
  ),
};

describe('barrelOf', () => {
  it('reads length and twist from the old free text', () => {
    const rifle = { ...exampleRifle, barrel: '560 мм, 11 твист' };
    expect(barrelOf(rifle)).toEqual({ length: 560, twist: 11, dir: 'R' });
    expect(barrelOf({ ...exampleRifle, barrel: 'LW 610 мм 1:10' })).toMatchObject({
      length: 610,
      twist: 10,
    });
  });

  it('prefers the fields over the text', () => {
    const rifle = {
      ...exampleRifle,
      barrel: '560 мм',
      barrelLength: 600,
      twist: 8,
      twistDir: 'L' as const,
    };
    expect(barrelOf(rifle)).toEqual({ length: 600, twist: 8, dir: 'L' });
  });
});

describe('caliberDiameter', () => {
  it('knows the common calibres', () => {
    expect(caliberDiameter('.308 Win')).toBe(7.82);
    expect(caliberDiameter('7,62×54R')).toBe(7.92);
    expect(caliberDiameter('6.5 Creedmoor')).toBe(6.72);
    expect(caliberDiameter('.223 Rem')).toBe(5.7);
    expect(caliberDiameter('что-то своё')).toBeNull();
  });
});

describe('comboVelocity', () => {
  const ammo = withBallistics.ammo.find((a) => a.id === FACTORY);

  it('takes a saved speed with its source; older ones count as typed in', () => {
    expect(comboVelocity(exampleRifle, ammo, { ammoId: FACTORY, velocity: 765 })).toEqual({
      value: 765,
      source: 'manual',
    });
    expect(
      comboVelocity(exampleRifle, ammo, {
        ammoId: FACTORY,
        velocity: 744,
        velocitySource: 'journal',
        velocityDate: '2026-11-16',
      }),
    ).toEqual({ value: 744, source: 'journal', date: '2026-11-16' });
  });

  it('estimates from the box for the barrel length when nothing is saved', () => {
    const rifle = { ...exampleRifle, barrelLength: 560 };
    expect(comboVelocity(rifle, ammo, { ammoId: FACTORY })).toEqual({
      value: 788,
      source: 'estimate',
      error: 20,
    });
    expect(comboVelocity(rifle, { ...ammo!, boxVelocity: null }, { ammoId: FACTORY })).toBeNull();
  });

  it('names the source', () => {
    expect(velocitySourceText({ value: 738, source: 'estimate', error: 20 })).toBe('оценка ±20');
    expect(velocitySourceText({ value: 744, source: 'journal', date: '2026-11-16' })).toBe(
      'по журналу, 16.11',
    );
    expect(velocitySourceText({ value: 790, source: 'manual' })).toBe('вручную');
  });
});

describe('calcSetup', () => {
  it('is ready with a BC and a speed, and says what is missing otherwise', () => {
    const rifle = withBallistics.rifles[0];
    const ready = calcSetup(withBallistics, rifle, SCOPE, HAND);
    expect(ready.missing).toEqual([]);
    expect(ready.base).toMatchObject({ dragModel: 'G7', bc: 0.243, v0: 790, sightHeight: 45 });
    // No twist on the rifle: no spin drift.
    expect(ready.base?.spin).toBeNull();
    const bare = calcSetup(exampleDiary, rifle, SCOPE, HAND);
    expect(bare.missing).toEqual(['bc']);
    expect(bare.base).toBeNull();
  });

  it('counts spin drift once the twist and the bullet length are known', () => {
    const rifle = { ...withBallistics.rifles[0], twist: 11 };
    const setup = calcSetup(withBallistics, rifle, SCOPE, HAND);
    expect(setup.base?.spin).toEqual({
      twist: 11,
      dir: 'R',
      weightGr: 175,
      diameterMm: 7.82,
      lengthMm: 31.5,
    });
  });
});

describe('journal', () => {
  it('averages usable series by distance', () => {
    const points = journalPoints(exampleDiary, RIFLE, SCOPE, HAND);
    expect(points.length).toBeGreaterThan(1);
    expect(points.map((p) => p.d)).toEqual([...points.map((p) => p.d)].sort((a, b) => a - b));
    for (const p of points) {
      expect(p.n).toBeGreaterThan(0);
      expect(p.spread).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives each series its own day’s air', () => {
    const points = journalFitPoints(exampleDiary, RIFLE, SCOPE, HAND);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(p.atmosphere.pressure).toBeGreaterThan(900);
  });

  it('turns a session’s weather into air, standard where it is missing', () => {
    const base = { rifleId: RIFLE, date: '2026-11-08', series: [] } as unknown as Session;
    expect(sessionAtmosphere({ ...base, temp: 6, pressure: 752 })).toEqual({
      temp: 6,
      pressure: 752 * 1.333224,
      humidity: 0.5,
    });
    expect(sessionAtmosphere(base).temp).toBe(15);
    expect(sessionAtmosphere({ ...base, altitude: 1000 }).pressure).toBeCloseTo(898.7, 0);
    expect(lastWeather(exampleDiary, RIFLE, HAND)).not.toBeNull();
  });
});

describe('fitOffer', () => {
  const fit = { v0: 744, error: 6 } as VelocityFit;

  it('offers a fit in place of an estimate or an outdated fit, never over a typed speed', () => {
    expect(fitOffer({ value: 738, source: 'estimate' }, fit)).toBe('accept');
    expect(fitOffer(null, fit)).toBe('accept');
    expect(fitOffer({ value: 730, source: 'journal' }, fit)).toBe('update');
    expect(fitOffer({ value: 742, source: 'journal' }, fit)).toBeNull();
    expect(fitOffer({ value: 790, source: 'manual' }, fit)).toBeNull();
    expect(fitOffer({ value: 738, source: 'estimate' }, null)).toBeNull();
  });
});
