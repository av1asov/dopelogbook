import { airAt, Atmosphere } from './atmosphere';
import { DragCurve, dragCurve, DragModel } from './drag-tables';

/** Where the wind blows from, on a clock face: 12 — into the face, 3 — from the right, 6 — from behind. */
export interface Wind {
  /** m/s */
  speed: number;
  clock: number;
}

/** What spin drift needs; without the bullet length it is not counted at all. */
export interface Spin {
  /** Inches per turn: 10 means 1:10″. */
  twist: number;
  dir: 'R' | 'L';
  weightGr: number;
  diameterMm: number;
  lengthMm: number;
}

export interface Coriolis {
  /** Degrees, north positive. */
  latitude: number;
  /** Direction of fire, degrees clockwise from north. */
  azimuth: number;
}

export interface BallisticInput {
  dragModel: DragModel;
  bc: number;
  /** Muzzle velocity, m/s. */
  v0: number;
  /** Sight over the bore, mm. */
  sightHeight: number;
  /** The scope is zeroed here, m. */
  zeroDist: number;
  atmosphere: Atmosphere;
  /** Conditions of the zero; the shot's own when absent. */
  zeroAtmosphere?: Atmosphere;
  wind?: Wind | null;
  /** Degrees, uphill positive. */
  lookAngle?: number;
  /** For the energy column. */
  weightGr?: number | null;
  spin?: Spin | null;
  coriolis?: Coriolis | null;
}

export interface TrajectoryPoint {
  /** Along the line of sight, m. */
  d: number;
  /** Correction to dial, mrad, up positive. */
  elev: number;
  /** Correction to dial, mrad, right positive: wind, spin drift and Coriolis together. */
  wind: number;
  /** Over the line of sight without a correction, mm. */
  height: number;
  /** Right of the line of sight without a correction, mm. */
  windage: number;
  /** Spin drift alone, mm, right positive; null when it is not counted. */
  drift: number | null;
  /** m/s */
  v: number;
  mach: number;
  /** Time of flight, s. */
  time: number;
  /** J; null without the bullet weight. */
  energy: number | null;
}

/** Furthest distance the solver goes to, m. */
export const MAX_RANGE = 1500;
/** The integration step, s. */
const DT = 0.0005;
const G = 9.80665;
/** kg/m² in one lb/in²: ballistic coefficients are quoted in lb/in². */
const KG_M2_PER_LB_IN2 = 703.0696;
const EARTH_ROTATION = 7.292115e-5;
const MIN_SPEED = 50;
const MAX_TIME = 10;
const GRAIN_KG = 6.479891e-5;
const LAPSE = 0.0065;
/** Barometric exponent minus one: density = pressure ÷ temperature. */
const DENSITY_POWER = 4.25588;

/** Everything the equations of motion need, in SI units and radians. */
export interface Env {
  /** π/8 ÷ BC: the drag deceleration is this × ρ × Cd(M) × v². */
  drag: number;
  curve: DragCurve;
  v0: number;
  /** Air at the muzzle. */
  density: number;
  soundSpeed: number;
  /** Lapse rate over the muzzle temperature, 1/m: how fast the air thins with height. */
  thinning: number;
  windX: number;
  windZ: number;
  omega: readonly [number, number, number] | null;
  look: number;
  sight: number;
}

/** A point of the trajectory in the frame of the line of sight, SI units. */
export interface Sample {
  d: number;
  /** m over the line of sight */
  h: number;
  /** m right of the line of sight */
  z: number;
  v: number;
  mach: number;
  t: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

function env(
  input: BallisticInput,
  atmosphere: Atmosphere,
  shot: { wind?: Wind | null; look?: number; coriolis?: Coriolis | null } = {},
): Env {
  const wind = shot.wind;
  const a = wind ? (wind.clock * Math.PI) / 6 : 0;
  const speed = wind?.speed ?? 0;
  let omega: Env['omega'] = null;
  if (shot.coriolis) {
    const lat = rad(shot.coriolis.latitude);
    const az = rad(shot.coriolis.azimuth);
    omega = [
      EARTH_ROTATION * Math.cos(lat) * Math.cos(az),
      EARTH_ROTATION * Math.sin(lat),
      -EARTH_ROTATION * Math.cos(lat) * Math.sin(az),
    ];
  }
  const air = airAt(atmosphere);
  return {
    drag: Math.PI / 8 / (input.bc * KG_M2_PER_LB_IN2),
    curve: dragCurve(input.dragModel),
    v0: input.v0,
    density: air.density,
    soundSpeed: air.soundSpeed,
    thinning: LAPSE / (atmosphere.temp + 273.15),
    // The air moves away from where the wind blows from.
    windX: -speed * Math.cos(a),
    windZ: -speed * Math.sin(a),
    omega,
    look: rad(shot.look ?? 0),
    sight: input.sightHeight / 1000,
  };
}

/**
 * The standard lapse rate makes density go as (T/T₀)^4.256 and the speed of sound as
 * (T/T₀)^½; over the heights a bullet climbs an exponential is the same to 1e-5.
 */
const densityAt = (e: Env, y: number): number =>
  e.density * Math.exp(-DENSITY_POWER * e.thinning * y);
const soundAt = (e: Env, y: number): number => e.soundSpeed * Math.sqrt(1 - e.thinning * y);

/** Writes the derivatives of state `s` (x y z vx vy vz) into `out`. */
function deriv(e: Env, s: Float64Array, out: Float64Array): void {
  const y = s[1];
  const vx = s[3];
  const vy = s[4];
  const vz = s[5];
  const rx = vx - e.windX;
  const rz = vz - e.windZ;
  const speed = Math.sqrt(rx * rx + vy * vy + rz * rz);
  const k = e.drag * densityAt(e, y) * e.curve(speed / soundAt(e, y)) * speed;
  let ax = -k * rx;
  let ay = -k * vy - G;
  let az = -k * rz;
  if (e.omega) {
    const [ox, oy, oz] = e.omega;
    ax -= 2 * (oy * vz - oz * vy);
    ay -= 2 * (oz * vx - ox * vz);
    az -= 2 * (ox * vy - oy * vx);
  }
  out[0] = vx;
  out[1] = vy;
  out[2] = vz;
  out[3] = ax;
  out[4] = ay;
  out[5] = az;
}

/** One RK4 step from `s` into `next`, using `work` as scratch space. */
function rk4(e: Env, s: Float64Array, next: Float64Array, work: Float64Array[], dt: number): void {
  const [k1, k2, k3, k4, tmp] = work;
  deriv(e, s, k1);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + (k1[i] * dt) / 2;
  deriv(e, tmp, k2);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + (k2[i] * dt) / 2;
  deriv(e, tmp, k3);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + k3[i] * dt;
  deriv(e, tmp, k4);
  for (let i = 0; i < 6; i++) next[i] = s[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

/**
 * Flies the bullet with the barrel `angle` radians over the line of sight and samples it
 * where the line-of-sight distance reaches each of `dists` (ascending). Stops early when
 * the bullet slows below 50 m/s or `stop` says so.
 */
export function integrate(
  e: Env,
  angle: number,
  dists: readonly number[],
  stop?: (sample: Sample, index: number) => boolean,
): Sample[] {
  const cos = Math.cos(e.look);
  const sin = Math.sin(e.look);
  const dir = e.look + angle;
  let s = Float64Array.of(
    e.sight * sin,
    -e.sight * cos,
    0,
    e.v0 * Math.cos(dir),
    e.v0 * Math.sin(dir),
    0,
  );
  let n = new Float64Array(6);
  const work = Array.from({ length: 5 }, () => new Float64Array(6));
  const out: Sample[] = [];
  let t = 0;
  let prevD = s[0] * cos + s[1] * sin;
  let next = 0;
  while (next < dists.length && t < MAX_TIME) {
    rk4(e, s, n, work, DT);
    const d = n[0] * cos + n[1] * sin;
    while (next < dists.length && d >= dists[next]) {
      const f = (dists[next] - prevD) / (d - prevD);
      const at = (i: number) => s[i] + (n[i] - s[i]) * f;
      const v = Math.hypot(at(3), at(4), at(5));
      const sample: Sample = {
        d: dists[next],
        h: -at(0) * sin + at(1) * cos,
        z: at(2),
        v,
        mach: v / soundAt(e, at(1)),
        t: t + f * DT,
      };
      out.push(sample);
      if (stop?.(sample, out.length - 1)) return out;
      next++;
    }
    [s, n] = [n, s];
    t += DT;
    prevD = d;
    if (Math.hypot(s[3], s[4], s[5]) < MIN_SPEED) break;
  }
  return out;
}

/** Barrel angle over the line of sight that puts the bullet on it at `dist`, or null. */
function angleThrough(e: Env, dist: number): number | null {
  const flight = dist / e.v0;
  let angle = (e.sight + (G * flight * flight) / 2) / dist;
  for (let i = 0; i < 30; i++) {
    const [sample] = integrate(e, angle, [dist]);
    if (!sample) return null;
    if (Math.abs(sample.h) < 1e-6) return angle;
    angle -= sample.h / dist;
  }
  return angle;
}

/** Barrel angle over the line of sight for the zero: on level ground, without wind. */
export function zeroAngle(input: BallisticInput): number | null {
  return angleThrough(env(input, input.zeroAtmosphere ?? input.atmosphere), input.zeroDist);
}

/** For a near zero at `dist` under the shot's own conditions, without wind. */
export function angleForZero(input: BallisticInput, dist: number): number | null {
  return angleThrough(env(input, input.atmosphere), dist);
}

/** Level shot without wind: what MPBR is about. */
export function levelEnv(input: BallisticInput): Env {
  return env(input, input.atmosphere);
}

/** Miller's gyroscopic stability with its velocity and air corrections. */
export function stability(spin: Spin, v0: number, atmosphere: Atmosphere): number {
  const d = spin.diameterMm / 25.4;
  const l = spin.lengthMm / 25.4 / d;
  const t = spin.twist / d;
  const fps = v0 / 0.3048;
  const fahrenheit = (atmosphere.temp * 9) / 5 + 32;
  const inHg = atmosphere.pressure * 0.02953;
  return (
    ((30 * spin.weightGr) / (t * t * d ** 3 * l * (1 + l * l))) *
    Math.cbrt(fps / 2800) *
    ((fahrenheit + 460) / 519) *
    (29.92 / inHg)
  );
}

const spinComplete = (spin: Spin | null | undefined): spin is Spin =>
  !!spin && spin.twist > 0 && spin.weightGr > 0 && spin.diameterMm > 0 && spin.lengthMm > 0;

/** Distances `step`, 2·`step`, … up to `max`. */
export const distances = (step: number, max: number, from = step): number[] => {
  const out: number[] = [];
  for (let d = from; d <= max + 1e-9; d += step) out.push(d);
  return out;
};

/**
 * The trajectory at each of `dists`. Rows stop where the bullet does; an empty list
 * means the zero cannot be reached.
 */
export function solve(input: BallisticInput, dists: readonly number[]): TrajectoryPoint[] {
  const angle = zeroAngle(input);
  if (angle == null) return [];
  const e = env(input, input.atmosphere, {
    wind: input.wind,
    look: input.lookAngle,
    coriolis: input.coriolis,
  });
  const sg = spinComplete(input.spin) ? stability(input.spin, input.v0, input.atmosphere) : null;
  const sign = input.spin?.dir === 'L' ? -1 : 1;
  const mass = input.weightGr ? input.weightGr * GRAIN_KG : null;
  return integrate(e, angle, dists).map((s) => {
    // Litz: drift in inches = 1.25 · (SG + 1.2) · t^1.83.
    const drift = sg != null ? sign * 1.25 * (sg + 1.2) * Math.pow(s.t, 1.83) * 0.0254 : null;
    const z = s.z + (drift ?? 0);
    return {
      d: s.d,
      // `|| 0` keeps −0 out of the table.
      elev: Math.atan2(-s.h, s.d) * 1000 || 0,
      wind: Math.atan2(-z, s.d) * 1000 || 0,
      height: s.h * 1000,
      windage: z * 1000,
      drift: drift == null ? null : drift * 1000,
      v: s.v,
      mach: s.mach,
      time: s.t,
      energy: mass ? (mass * s.v * s.v) / 2 : null,
    };
  });
}
