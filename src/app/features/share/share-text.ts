import {
  Ammo,
  ammoById,
  ammoName,
  Diary,
  fmt,
  fmtTemp,
  groupAng,
  GroupUnit,
  MOA_PER_MRAD,
  posName,
  rdate,
  restName,
  Rifle,
  rifleById,
  scopeById,
  Series,
  Session,
} from '../../core/ballistics';
import { offsetShort } from '../../core/target/measure';

/** What goes into a shared picture and message; remembered between shares. */
export interface ShareOptions {
  /** Marks over the photo; off — the clean photo. */
  marks: boolean;
  /** Rifle, ammo and scope. */
  combo: boolean;
  /** Weather and wind. */
  conditions: boolean;
  /** The range's name: off by default, it tells where the person shoots. */
  place: boolean;
}

export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  marks: true,
  combo: true,
  conditions: true,
  place: false,
};

/** One series as words: the picture's plate and the message are built from the same lines. */
export interface SeriesSummary {
  /** «Серия 2 · 100 м · 5/5» */
  title: string;
  /** «32 мм · 1,1 MOA» */
  group: string;
  /** «СТП ↑6 →2 мм» */
  offset: string;
  /** «лёжа, сошки» */
  stance: string;
  /** «Атаман А-01 .308 · Igla Shakal 160 · Artelv CRS» */
  combo: string;
  /** «08.11.2026 · Калибр · +6 °C · 752 мм · ветер 3 м/с» */
  conditions: string;
}

/**
 * The ammo by its name only. A handload's recipe — powder, charge and the rest — never
 * leaves the app, so an unnamed handload goes by its bullet.
 */
export function publicAmmoName(ammo: Ammo | null | undefined): string {
  if (!ammo) return '';
  if (ammo.name) return ammo.name;
  return ammo.type === 'handload' ? ammo.bullet || 'самоснаряженный' : ammoName(ammo);
}

/** «Атаман А-01 .308»: the calibre's first word, unless the name already has it. */
function rifleTitle(rifle: Rifle | null): string {
  if (!rifle) return '';
  const calibre = rifle.caliber?.trim().split(/\s+/)[0] ?? '';
  return calibre && !rifle.name.includes(calibre) ? `${rifle.name} ${calibre}` : rifle.name;
}

/** «1,1 MOA» or «0,32 MRAD»: one decimal is enough for a MOA on a picture. */
function angleText(mrad: number, unit: GroupUnit): string {
  return unit === 'MOA' ? `${fmt(mrad * MOA_PER_MRAD, 1)} MOA` : `${fmt(mrad, 2)} MRAD`;
}

function offsetLine(series: Series): string {
  if (series.offUp == null && series.offRight == null) return '';
  const text = offsetShort({ offUp: series.offUp ?? 0, offRight: series.offRight ?? 0 });
  return text === 'в точку' ? 'СТП в точку' : `СТП ${text} мм`;
}

function conditionsLine(session: Session, series: Series | null, options: ShareOptions): string {
  const parts = [rdate(session.date)];
  if (options.place && session.place) parts.push(session.place);
  if (options.conditions) {
    if (session.temp != null) parts.push(fmtTemp(session.temp));
    if (session.pressure != null) parts.push(`${fmt(session.pressure, 0)} мм`);
    if (series?.windSpeed)
      parts.push(`ветер ${fmt(series.windSpeed, series.windSpeed % 1 ? 1 : 0)} м/с`);
  }
  return parts.join(' · ');
}

function comboLine(diary: Diary, session: Session, series: Series | null): string {
  const rifleName = rifleTitle(rifleById(diary, session.rifleId));
  return [
    rifleName,
    series ? publicAmmoName(ammoById(diary, series.ammoId)) : '',
    series ? scopeById(diary, series.scopeId)?.name : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function seriesSummary(
  diary: Diary,
  session: Session,
  si: number,
  number: number,
  options: ShareOptions,
  unit: GroupUnit,
): SeriesSummary {
  const series = session.series[si];
  const title = [
    `Серия ${number}`,
    series.dist != null ? `${series.dist} м` : '',
    series.shots ? `${series.hits ?? series.shots}/${series.shots}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const angle = groupAng(series);
  const group =
    series.group != null
      ? [`${fmt(series.group, 0)} мм`, angle != null ? angleText(angle, unit) : '']
          .filter(Boolean)
          .join(' · ')
      : '';
  return {
    title,
    group,
    offset: offsetLine(series),
    stance: [posName(series.pos), restName(series.rest)].filter(Boolean).join(', '),
    combo: options.combo ? comboLine(diary, session, series) : '',
    conditions: conditionsLine(session, series, options),
  };
}

/** The message: the same as the plate, in lines. */
export function seriesText(summary: SeriesSummary): string {
  const [mm, angle] = summary.group.split(' · ');
  const result = [mm ? `Группа ${mm}${angle ? ` (${angle})` : ''}` : '', summary.offset]
    .filter(Boolean)
    .join(' · ');
  return [summary.title, result, summary.combo, summary.conditions].filter(Boolean).join('\n');
}

/** A whole session in a message: a line per series. */
export function sessionText(
  diary: Diary,
  session: Session,
  series: readonly { si: number; number: number }[],
  options: ShareOptions,
  unit: GroupUnit,
): string {
  const rifle = rifleById(diary, session.rifleId);
  const head = [
    conditionsLine(session, null, options),
    options.combo ? rifleTitle(rifle) : '',
  ].filter(Boolean);
  const lines = series.map(({ si, number }) => {
    const s = seriesSummary(diary, session, si, number, options, unit);
    const ammo = options.combo ? publicAmmoName(ammoById(diary, session.series[si].ammoId)) : '';
    return [s.title, s.group, s.offset, ammo].filter(Boolean).join(' · ');
  });
  return [...head, ...lines].join('\n');
}

/** «DOPE серия 2 08.11.2026.jpg» */
export function shareFileName(session: Session, number: number | null): string {
  const what = number != null ? ` серия ${number}` : '';
  return `DOPE${what} ${rdate(session.date)}.jpg`.replace(/[\\/:*?"<>|]/g, '_');
}
