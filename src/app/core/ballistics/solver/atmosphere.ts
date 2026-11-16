export interface Atmosphere {
  /** °C at the firing point. */
  temp: number;
  /** Station pressure, hPa: what a barometer shows there, not reduced to sea level. */
  pressure: number;
  /** Relative humidity, 0…1. */
  humidity: number;
}

export const HPA_PER_MMHG = 1.333224;
export const STANDARD_PRESSURE_HPA = 1013.25;
export const DEFAULT_HUMIDITY = 0.5;

/** +15 °C and 760 mm Hg, with the humidity the app assumes when nothing else is known. */
export const STANDARD_ATMOSPHERE: Atmosphere = {
  temp: 15,
  pressure: STANDARD_PRESSURE_HPA,
  humidity: DEFAULT_HUMIDITY,
};

const R_DRY = 287.058;
const R_VAPOUR = 461.495;
const LAPSE = 0.0065;
const BAROMETRIC_EXPONENT = 5.25588;
const KELVIN = 273.15;

export const mmHgToHpa = (mm: number): number => mm * HPA_PER_MMHG;
export const hpaToMmHg = (hpa: number): number => hpa / HPA_PER_MMHG;

/** Pressure of the standard atmosphere at this height above sea level, hPa. */
export const pressureAtAltitude = (meters: number): number =>
  STANDARD_PRESSURE_HPA * Math.pow(1 - 2.25577e-5 * meters, BAROMETRIC_EXPONENT);

/** Saturation vapour pressure over water, Pa (Magnus–Tetens). */
const saturationPressure = (celsius: number): number =>
  610.78 * Math.pow(10, (7.5 * celsius) / (celsius + 237.3));

export interface AirState {
  /** kg/m³ */
  density: number;
  /** m/s */
  soundSpeed: number;
}

/**
 * Air `height` metres above the firing point: temperature falls with the standard lapse
 * rate and pressure follows the barometric formula, so steep shots are counted honestly.
 */
export function airAt(atmosphere: Atmosphere, height = 0): AirState {
  const t0 = atmosphere.temp + KELVIN;
  const t = t0 - LAPSE * height;
  const p = atmosphere.pressure * 100 * Math.pow(t / t0, BAROMETRIC_EXPONENT);
  const vapour = Math.min(1, Math.max(0, atmosphere.humidity)) * saturationPressure(t - KELVIN);
  return {
    density: (p - vapour) / (R_DRY * t) + vapour / (R_VAPOUR * t),
    soundSpeed: 20.0467 * Math.sqrt(t),
  };
}
