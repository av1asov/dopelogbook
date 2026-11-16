import {
  Atmosphere,
  BallisticInput,
  boxToMuzzle,
  distances,
  estimateV0,
  factMpbr,
  fitVelocity,
  FitPoint,
  mpbr,
  profile,
  solve,
  STANDARD_ATMOSPHERE,
} from './index';
import reference from '../../../../testing/ballistics-ref.json';

const MATCH: BallisticInput = {
  dragModel: 'G7',
  bc: 0.218,
  v0: 795,
  sightHeight: 45,
  zeroDist: 100,
  atmosphere: STANDARD_ATMOSPHERE,
  weightGr: 168,
};

const elevAt = (input: BallisticInput, d: number): number =>
  solve(input, [d]).find((r) => r.d === d)?.elev ?? NaN;

describe('solve', () => {
  it('needs no correction at the zero distance', () => {
    expect(Math.abs(elevAt(MATCH, 100))).toBeLessThan(0.001);
    const cold = { ...MATCH, atmosphere: { temp: -15, pressure: 990, humidity: 0.8 } };
    expect(Math.abs(elevAt(cold, 100))).toBeLessThan(0.001);
  });

  it('needs less elevation in warmer air', () => {
    const at = (temp: number) =>
      solve({ ...MATCH, atmosphere: { ...STANDARD_ATMOSPHERE, temp } }, [300, 600]);
    const [cold300, cold600] = at(-10);
    const [warm300, warm600] = at(30);
    expect(warm300.elev).toBeLessThan(cold300.elev);
    expect(warm600.elev).toBeLessThan(cold600.elev);
  });

  it('slows down and drops monotonically', () => {
    const rows = solve(MATCH, distances(100, 1000));
    expect(rows.map((r) => r.d)).toEqual(distances(100, 1000));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].v).toBeLessThan(rows[i - 1].v);
      expect(rows[i].elev).toBeGreaterThan(rows[i - 1].elev);
      expect(rows[i].time).toBeGreaterThan(rows[i - 1].time);
    }
    expect(rows[0].energy).toBeGreaterThan(2500);
  });

  it('dials right for a wind from the right and left for one from the left', () => {
    const right = solve({ ...MATCH, wind: { speed: 4, clock: 3 } }, [300])[0];
    const left = solve({ ...MATCH, wind: { speed: 4, clock: 9 } }, [300])[0];
    const head = solve({ ...MATCH, wind: { speed: 4, clock: 12 } }, [300])[0];
    expect(right.windage).toBeLessThan(0);
    expect(right.wind).toBeGreaterThan(0.3);
    expect(left.wind).toBeCloseTo(-right.wind, 6);
    expect(Math.abs(head.wind)).toBeLessThan(1e-6);
    // A head wind slows the bullet: more drop than in still air.
    expect(head.elev).toBeGreaterThan(elevAt(MATCH, 300));
  });

  it('drifts right with a right-hand twist, and only when the bullet length is known', () => {
    const spin = { twist: 11, dir: 'R' as const, weightGr: 168, diameterMm: 7.82, lengthMm: 31 };
    const [row] = solve({ ...MATCH, spin }, [600]);
    expect(row.drift).toBeGreaterThan(50);
    expect(row.drift).toBeLessThan(400);
    expect(row.wind).toBeLessThan(0);
    const [left] = solve({ ...MATCH, spin: { ...spin, dir: 'L' } }, [600]);
    expect(left.drift).toBeCloseTo(-(row.drift as number), 6);
    const [unknown] = solve({ ...MATCH, spin: { ...spin, lengthMm: 0 } }, [600]);
    expect(unknown.drift).toBeNull();
    expect(unknown.wind).toBe(0);
  });

  it('counts an uphill shot with less drop than a level one', () => {
    const level = elevAt(MATCH, 500);
    const uphill = elevAt({ ...MATCH, lookAngle: 30 }, 500);
    expect(uphill).toBeLessThan(level);
    expect(uphill).toBeGreaterThan(level * 0.75);
  });

  it('pushes eastward shots up in the northern hemisphere when Coriolis is on', () => {
    const east = elevAt({ ...MATCH, coriolis: { latitude: 55, azimuth: 90 } }, 800);
    const west = elevAt({ ...MATCH, coriolis: { latitude: 55, azimuth: 270 } }, 800);
    expect(east).toBeLessThan(west);
    const [north] = solve({ ...MATCH, coriolis: { latitude: 55, azimuth: 0 } }, [800]);
    // Northern hemisphere: the bullet drifts right, so the correction is to the left.
    expect(north.wind).toBeLessThan(0);
  });
});

describe('mpbr', () => {
  it('puts the peak of the optimal zero exactly at the radius', () => {
    for (const zone of [100, 150, 200]) {
      const result = mpbr(MATCH, zone);
      expect(Math.abs(result.optimal.peak.h - zone / 2)).toBeLessThan(1);
      expect(result.optimal.above).toBeNull();
      expect(result.optimal.near).toBeLessThan(result.optimal.far as number);
      expect(result.optimal.far).toBeLessThan(result.optimal.mpbr as number);
    }
  });

  it('gives the longest range for the optimal zero, and flags rows over the zone', () => {
    const result = mpbr(MATCH, 100);
    const best = result.optimal.mpbr as number;
    for (const { line } of result.nears) {
      if (!line.above) expect(line.mpbr).toBeLessThanOrEqual(best + 0.5);
    }
    const close = result.nears.find((n) => n.dist === 25)?.line;
    expect(close?.above).not.toBeNull();
    expect(close?.peak.h).toBeGreaterThan(50);
    expect(result.current?.far).toBeCloseTo(100, 0);
  });

  it('notes a sight higher than the radius', () => {
    expect(mpbr({ ...MATCH, sightHeight: 60 }, 100).sightBelowZone).toBe(true);
    expect(mpbr(MATCH, 100).sightBelowZone).toBe(false);
  });

  it('starts the profile at the muzzle, under the line of sight', () => {
    const result = mpbr(MATCH, 100);
    const points = profile(MATCH, result.optimal.angle, 240);
    expect(points[0]).toEqual({ d: 0, h: -45 });
    expect(Math.max(...points.map((p) => p.h))).toBeCloseTo(50, 0);
  });

  describe('fact from the journal', () => {
    const line = mpbr(MATCH, 100).current!;
    const calc = profile(MATCH, line.angle, 300);
    const at = (d: number) => calc.find((p) => p.d === d)!.h;

    it('equals the calculated MPBR when the journal matches the curve at 100 and 200 m', () => {
      expect(line.mpbr!).toBeGreaterThan(100);
      expect(line.mpbr!).toBeLessThan(200);
      const journal = [100, 200].map((d) => ({ d, h: at(d) }));
      expect(Math.abs(factMpbr(calc, journal, 50)! - line.mpbr!)).toBeLessThanOrEqual(2);
    });

    it('comes in shorter when the journal is lower than the curve', () => {
      const journal = [
        { d: 100, h: at(100) },
        { d: 200, h: at(200) - 18 },
      ];
      expect(factMpbr(calc, journal, 50)!).toBeLessThan(line.mpbr! - 2);
    });

    it('is not given without journal points past the exit', () => {
      const journal = [50, 100].map((d) => ({ d, h: at(d) }));
      expect(factMpbr(calc, journal, 50)).toBeNull();
    });
  });
});

describe('velocity', () => {
  it('estimates V₀ for a shorter barrel from the box speed', () => {
    const v0 = estimateV0({ boxVelocity: 750, boxBarrelMm: 600 }, 560, {
      bc: 0.391,
      dragModel: 'G1',
    });
    expect(v0).toBe(738);
    expect(estimateV0({ boxVelocity: 750 }, null, {})).toBe(750);
  });

  it('turns a speed at 10 or 25 m into a muzzle speed', () => {
    const drag = { bc: 0.218, dragModel: 'G7' as const };
    const v10 = boxToMuzzle(780, 'V10', drag);
    const v25 = boxToMuzzle(780, 'V25', drag);
    expect(v10).toBeGreaterThan(780);
    expect(v25).toBeGreaterThan(v10);
    expect(v25 - 780).toBeLessThan(25);
    expect(boxToMuzzle(780, 'V25', {})).toBe(780);
  });

  it('finds V₀ back from a synthetic journal with noise', () => {
    const truth = { ...MATCH, v0: 740 };
    const days: Atmosphere[] = [
      { temp: 5, pressure: 1000, humidity: 0.6 },
      { temp: 22, pressure: 990, humidity: 0.4 },
    ];
    // Deterministic noise within ±0.05 mrad.
    const noise = [0.04, -0.03, 0.05, -0.05, 0.01, -0.02, 0.03, -0.04, 0.02, 0];
    const points: FitPoint[] = [];
    let i = 0;
    for (const atmosphere of days) {
      for (const row of solve({ ...truth, atmosphere }, [200, 300, 400, 500, 600])) {
        points.push({
          d: row.d,
          elev: row.elev + noise[i++ % noise.length],
          weight: 5,
          atmosphere,
        });
      }
    }
    const { v0: _, ...base } = MATCH;
    const fit = fitVelocity(base, points, 0.1);
    expect(fit).not.toBeNull();
    expect(Math.abs((fit?.v0 ?? 0) - 740)).toBeLessThan(10);
    expect(fit?.error).toBeLessThan(10);
    expect(fit?.short).toBe(false);
    expect(fit?.n).toBe(10);
  });

  it('matches the owner’s .308 from the box, the journal and the forecast', () => {
    const atmosphere = { temp: 3.5, pressure: 1013.25, humidity: 0.5 };
    const drag = { bc: 0.391, dragModel: 'G1' as const };
    const estimate = estimateV0({ boxVelocity: 750, boxBarrelMm: 600 }, 560, drag) as number;
    expect(estimate).toBeGreaterThanOrEqual(735);
    expect(estimate).toBeLessThanOrEqual(740);

    const base = { ...drag, sightHeight: 55.5, zeroDist: 100 };
    const journal: FitPoint[] = [
      { d: 150, elev: 0.4, weight: 5, atmosphere },
      { d: 200, elev: 0.8, weight: 5, atmosphere },
      { d: 300, elev: 2.0, weight: 5, atmosphere },
    ];
    const fit = fitVelocity(base, journal, 0.1, estimate);
    expect(fit?.n).toBe(2);
    expect(fit?.short).toBe(true);
    expect(Math.abs((fit?.v0 ?? 0) - 744)).toBeLessThanOrEqual(8);

    const forecast = solve({ ...base, v0: fit?.v0 ?? 0, atmosphere }, [400, 500, 600]);
    expect(Math.abs(forecast[0].elev - 3.5)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(forecast[1].elev - 5.2)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(forecast[2].elev - 7.3)).toBeLessThanOrEqual(0.15);
  });
});

// Generated by tools/ballistics-ref/generate.py with py-ballisticcalc: the same
// point-mass model and drag tables, solved by an independent program.
describe('solve against py-ballisticcalc', () => {
  const ANGLE_TOLERANCE = 0.05;
  const ANGLE_RANGE = 800;
  const RELATIVE_TOLERANCE = 0.01;

  for (const ref of reference.cases) {
    const { temp, pressure, humidity } = ref.atmosphere;
    it(`agrees on ${ref.name} at ${temp} °C, ${pressure} hPa`, () => {
      const input: BallisticInput = {
        dragModel: ref.dragModel as BallisticInput['dragModel'],
        bc: ref.bc,
        v0: ref.v0,
        sightHeight: ref.sightHeight,
        zeroDist: ref.zeroDist,
        atmosphere: { temp, pressure, humidity },
        wind: ref.wind,
        weightGr: ref.weightGr,
      };
      const rows = solve(
        input,
        ref.rows.map((r) => r.d),
      );
      expect(rows.map((r) => r.d)).toEqual(ref.rows.map((r) => r.d));
      ref.rows.forEach((expected, i) => {
        const row = rows[i];
        const at = `${expected.d} m`;
        if (expected.d <= ANGLE_RANGE) {
          expect(Math.abs(row.elev - expected.elev), `elev at ${at}`).toBeLessThanOrEqual(
            ANGLE_TOLERANCE,
          );
          expect(Math.abs(Math.abs(row.wind) - expected.wind), `wind at ${at}`).toBeLessThanOrEqual(
            ANGLE_TOLERANCE,
          );
        }
        expect(Math.abs(row.v / expected.v - 1), `velocity at ${at}`).toBeLessThanOrEqual(
          RELATIVE_TOLERANCE,
        );
        expect(Math.abs(row.time / expected.time - 1), `time at ${at}`).toBeLessThanOrEqual(
          RELATIVE_TOLERANCE,
        );
      });
    });
  }
});
