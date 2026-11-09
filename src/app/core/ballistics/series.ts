import { fmt } from './format';
import {
  Ammo,
  GroupUnit,
  Position,
  Rest,
  Scope,
  ScopeType,
  ScopeUnits,
  Series,
  Session,
} from './model';

export const MOA_PER_MRAD = 3.4377;

const MRAD_PER_UNIT: Record<ScopeUnits, number> = {
  MRAD: 1,
  MIL: 1,
  MOA: 1 / MOA_PER_MRAD,
  CM100: 0.1,
  MM100: 0.01,
};

const DEFAULT_CLICK: Record<ScopeUnits, number> = {
  MRAD: 0.1,
  MIL: 0.1,
  MOA: 0.25,
  CM100: 1,
  MM100: 10,
};

export const SCOPE_TYPES: readonly (readonly [ScopeType, string])[] = [
  ['optic', 'оптика'],
  ['thermal', 'тепловизор'],
  ['red-dot', 'коллиматор'],
];

export const SCOPE_UNITS: readonly (readonly [ScopeUnits, string])[] = [
  ['MRAD', 'MRAD'],
  ['MIL', 'MIL'],
  ['MOA', 'MOA'],
  ['CM100', 'см/100'],
  ['MM100', 'мм/100'],
];

/** Short enough for a table heading. */
export const unitShort = (units: ScopeUnits): string =>
  SCOPE_UNITS.find(([value]) => value === units)?.[1] ?? units;

export const unitLabel = (units: ScopeUnits): string =>
  units === 'CM100' || units === 'MM100' ? `${unitShort(units)} м` : units;

export const defaultClick = (units: ScopeUnits): number => DEFAULT_CLICK[units];

export const scopeTypeName = (type: ScopeType): string =>
  SCOPE_TYPES.find(([value]) => value === type)?.[1] ?? '';

export const unitsOf = (scope: Scope | null | undefined): ScopeUnits => scope?.units ?? 'MRAD';

export const clickOf = (scope: Scope | null | undefined): number =>
  scope?.click || DEFAULT_CLICK[unitsOf(scope)];

/** As many decimals as one click has; angular units always keep at least one. */
export function unitDigits(scope: Scope | null | undefined): number {
  const decimals = String(clickOf(scope)).split('.')[1]?.length ?? 0;
  const units = unitsOf(scope);
  return units === 'CM100' || units === 'MM100' ? decimals : Math.max(1, decimals);
}

export const toMrad = (value: number, units: ScopeUnits): number => value * MRAD_PER_UNIT[units];

export const toUnits = (mrad: number, units: ScopeUnits): number => mrad / MRAD_PER_UNIT[units];

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

/** Elevation corrected by the group centre, mrad: a group 1 mm/m high needs 1 mrad less. */
export function elevEff(x: Pick<Series, 'elev' | 'offUp' | 'dist'>): number | null {
  if (x.elev == null) return null;
  if (x.offUp == null || !((x.dist ?? 0) > 0)) return x.elev;
  return x.elev - x.offUp / (x.dist as number);
}

export function offText(x: Pick<Series, 'offUp' | 'offRight' | 'dist'>, units: ScopeUnits): string {
  const dist = x.dist ?? 0;
  if (!(dist > 0) || (x.offUp == null && x.offRight == null)) return '';
  const parts: string[] = [];
  if (x.offUp)
    parts.push((x.offUp > 0 ? '↑' : '↓') + fmt(toUnits(Math.abs(x.offUp) / dist, units), 2));
  if (x.offRight) {
    parts.push((x.offRight > 0 ? '→' : '←') + fmt(toUnits(Math.abs(x.offRight) / dist, units), 2));
  }
  return parts.length ? `${parts.join(' ')} ${unitLabel(units)}` : 'в центре';
}

export interface SeriesStatus {
  use: boolean;
  why?: string;
  manual?: boolean;
}

/** Whether the series goes into the DOPE card. */
export function seriesStatus(x: Partial<Series>): SeriesStatus {
  if (x.kind === 'zeroing') return { use: false, why: 'пристрелка: только в ресурс ствола' };
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

export function fmtAng(mrad: number | null | undefined, unit: GroupUnit): string {
  if (mrad == null) return '—';
  return unit === 'MOA' ? `${fmt(mrad * MOA_PER_MRAD, 2)} MOA` : `${fmt(mrad, 2)} MRAD`;
}

/** Clicks dialled while zeroing: ↑3 ←2. */
export function clicksText(
  up: number | null | undefined,
  right: number | null | undefined,
): string {
  return [
    up ? `${up > 0 ? '↑' : '↓'}${Math.abs(up)}` : '',
    right ? `${right > 0 ? '→' : '←'}${Math.abs(right)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Shots forming the group: the cold shot is fired in the series but stays out of the group. */
export function groupShots(s: Session, si: number): number | null {
  const shots = s.series[si]?.shots;
  if (shots == null) return null;
  return s.coldShot?.si === si && !s.coldShot.standalone ? shots - 1 : shots;
}

/** Angular size of a series' group, or null when it is unknown or has under 3 shots. */
export function seriesGroupAng(s: Session, si: number): number | null {
  if (s.series[si]?.kind === 'zeroing') return null;
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
  scopeId?: string | null,
): boolean {
  return (
    (!ammoId || x.ammoId === ammoId) &&
    (!scopeId || x.scopeId === scopeId) &&
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
