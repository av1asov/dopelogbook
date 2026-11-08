import { fmt } from './format';
import { Ammo, Position, Rest, Series, Session, Units } from './model';

export const MOA_PER_MIL = 3.4377;

export const POSITIONS: readonly (readonly [Position, string])[] = [
  ['prone', 'лёжа'],
  ['sit', 'сидя'],
  ['kneel', 'с колена'],
  ['stand', 'стоя'],
];

export const RESTS: readonly (readonly [Rest, string])[] = [
  ['bench', 'стол'],
  ['bipod', 'сошки'],
  ['bag', 'мешок, рюкзак'],
  ['barricade', 'баррикада'],
  ['tripod', 'штатив'],
  ['sling', 'ремень'],
  ['none', 'без опоры'],
];

export const posName = (code?: string): string =>
  POSITIONS.find(([value]) => value === code)?.[1] ?? '';

export const restName = (code?: string): string =>
  RESTS.find(([value]) => value === code)?.[1] ?? '';

export const stanceName = (x: Pick<Series, 'pos' | 'rest'>): string =>
  [posName(x.pos), restName(x.rest)].filter(Boolean).join(' · ');

export const devName = (device?: string): string => device || 'без устройства';

export function ammoName(a: Ammo | Partial<Ammo> | null | undefined): string {
  if (!a) return '—';
  if (a.name) return a.name;
  if (a.type === 'handload') {
    const charge = a.charge != null ? ` ${fmt(a.charge, 1)} ${a.chargeUnit || 'gr'}` : '';
    return [a.bullet, a.powder && `${a.powder}${charge}`].filter(Boolean).join(' / ') || 'Самосбор';
  }
  return [a.maker, a.line].filter(Boolean).join(' ') || a.bullet || 'Патрон';
}

export function ammoShort(a: Ammo | null | undefined): string {
  const name = ammoName(a);
  return name.length > 34 ? name.slice(0, 32) + '…' : name;
}

/** Series without a recorded position or rest count as stable: older records have neither. */
export function isStable(x: Pick<Series, 'pos' | 'rest'>): boolean {
  return (
    (!x.rest || ['bench', 'bipod', 'bag'].includes(x.rest)) &&
    (!x.pos || x.pos === 'prone' || x.pos === 'sit')
  );
}

export const toUnits = (mrad: number, units: Units): number =>
  units === 'MOA' ? mrad * MOA_PER_MIL : mrad;

/** Elevation corrected by the group centre: a group 1 mm/m high needs 1 MIL less. */
export function elevEff(x: Series, units: Units): number | null {
  if (x.elev == null) return null;
  if (x.offUp == null || !((x.dist ?? 0) > 0)) return x.elev;
  return x.elev - toUnits(x.offUp / (x.dist as number), units);
}

export function offText(x: Series, units: Units): string {
  const dist = x.dist ?? 0;
  if (!(dist > 0) || (x.offUp == null && x.offRight == null)) return '';
  const parts: string[] = [];
  if (x.offUp)
    parts.push((x.offUp > 0 ? '↑' : '↓') + fmt(toUnits(Math.abs(x.offUp) / dist, units), 2));
  if (x.offRight) {
    parts.push((x.offRight > 0 ? '→' : '←') + fmt(toUnits(Math.abs(x.offRight) / dist, units), 2));
  }
  return parts.length ? `${parts.join(' ')} ${units}` : 'в центре';
}

export interface SeriesStatus {
  use: boolean;
  why?: string;
  manual?: boolean;
}

/** Whether the series goes into the DOPE card. */
export function seriesStatus(x: Series): SeriesStatus {
  if (x.skip) return { use: false, why: x.skipReason || 'исключена вручную', manual: true };
  if (x.dist == null || x.elev == null) return { use: false, why: 'нет дистанции или поправки' };
  if ((x.shots ?? 0) > 0 && !x.hits && x.offUp == null) {
    return { use: false, why: 'всё мимо, СТП не записана' };
  }
  return { use: true };
}

/** Angular group size in mrad: mm / m. */
export function groupAng(x: Pick<Series, 'group' | 'dist'>): number | null {
  const group = x.group ?? 0;
  const dist = x.dist ?? 0;
  return group > 0 && dist > 0 ? group / dist : null;
}

export function fmtAng(mrad: number | null | undefined, unit: Units): string {
  if (mrad == null) return '—';
  return unit === 'MOA' ? `${fmt(mrad * MOA_PER_MIL, 2)} MOA` : `${fmt(mrad, 2)} MIL`;
}

/** Shots forming the group: the cold shot is fired in the series but stays out of the group. */
export function groupShots(s: Session, si: number): number | null {
  const shots = s.series[si]?.shots;
  if (shots == null) return null;
  return s.coldShot?.si === si && !s.coldShot.standalone ? shots - 1 : shots;
}

/** Angular size of a series' group, or null when it is unknown or has under 3 shots. */
export function seriesGroupAng(s: Session, si: number): number | null {
  const angle = groupAng(s.series[si]);
  if (angle == null) return null;
  const shots = groupShots(s, si);
  return shots == null || shots >= 3 ? angle : null;
}

/** `'*'` matches any device or rest; an empty string means none was recorded. */
export function seriesMatches(
  x: Series,
  ammoId: string | null | undefined,
  device = '*',
  rest = '*',
): boolean {
  return (
    (!ammoId || x.ammoId === ammoId) &&
    (device === '*' || (x.device || '') === device) &&
    (rest === '*' || (x.rest || '') === rest)
  );
}

export function sessionRounds(s: Session, ammoId?: string | null): number {
  const inSeries = s.series
    .filter((x) => seriesMatches(x, ammoId))
    .reduce((sum, x) => sum + (x.shots || 0), 0);
  const cold = s.coldShot?.standalone;
  const standalone = cold && (!ammoId || cold.ammoId === ammoId) ? 1 : 0;
  return inSeries + standalone + (ammoId ? 0 : s.extraRounds || 0);
}
