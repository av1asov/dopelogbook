import { Ammo, ColdShot, PhotoRef, Rifle, Series, Session } from '../ballistics/model';

/* Documents from older versions have no fixed shape, so they are read untyped. */
type Raw = any;

export interface LegacyResult {
  rifles: Rifle[];
  ammo: Ammo[];
  sessions: Session[];
  /** Sessions had more than one cold series; the extra ones are excluded from the card. */
  extraColdSeries: number;
}

const stamp = (created: unknown): string => new Date(Number(created) || 0).toISOString();

export const compact = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as T;

const COLD_REASON = 'холодный ствол, учитывается отдельно';

/** The earliest versions kept ammo on the rifle: one field or a `loads` list. */
function migrateRifle(
  id: string,
  r: Raw,
): { combos: Rifle['combos']; ammo: Ammo[]; loadMap?: Record<string, string>; firstLoad?: string } {
  if (Array.isArray(r.combos)) {
    return {
      combos: r.combos.map((c: Raw) => ({ ammoId: c.ammoId, velocity: c.velocity })),
      ammo: [],
    };
  }
  const loads: Raw[] =
    Array.isArray(r.loads) && r.loads.length
      ? r.loads
      : [
          {
            id: 'L0',
            name: [r.cartridge, r.bullet].filter(Boolean).join(' ') || 'Основной патрон',
            bullet: r.bullet || '',
            velocity: r.velocity ?? null,
          },
        ];
  const caliber = r.caliber ?? r.cartridge ?? '';
  const createdAt = stamp(r.created);
  const loadMap: Record<string, string> = {};
  const ammo = loads.map((load): Ammo => {
    const ammoId = `${id}-${load.id}`;
    loadMap[load.id] = ammoId;
    return {
      id: ammoId,
      createdAt,
      updatedAt: createdAt,
      type: 'factory',
      name: load.name || '',
      caliber,
      bullet: load.bullet || '',
      notes: 'Перенесено из прежней версии дневника. Уточните производителя или рецепт.',
    };
  });
  return {
    combos: loads.map((load) => ({ ammoId: loadMap[load.id], velocity: load.velocity ?? null })),
    ammo,
    loadMap,
    firstLoad: loads[0].id,
  };
}

/** Reads every past layout as a flat list of series. */
function flatSeries(s: Raw): Raw[] {
  if (Array.isArray(s.series) && !s.series.some((x: Raw) => Array.isArray(x.entries))) {
    return s.series;
  }
  const blocks: Raw[] = Array.isArray(s.series)
    ? s.series
    : [{ ammoId: s.ammoId, device: s.device || '', entries: s.entries || [] }];
  return blocks.flatMap((block) =>
    (block.entries || []).map((entry: Raw) => ({
      ammoId: block.ammoId,
      device: block.device || '',
      ...entry,
    })),
  );
}

function extraRounds(s: Raw, series: Raw[]): number {
  if (s.extraRounds != null) return s.extraRounds;
  const recorded =
    s.rounds ??
    (Array.isArray(s.series)
      ? s.series.reduce((sum: number, x: Raw) => sum + (x.rounds || 0), 0)
      : 0);
  return Math.max(0, recorded - series.reduce((sum, x) => sum + (x.shots || 0), 0));
}

function toSeries(x: Raw): Series {
  const skip = x.skip || (x.skip === undefined && x.ok === false);
  return compact({
    ammoId: x.ammoId ?? '',
    device: x.device,
    pos: x.pos,
    rest: x.rest,
    dist: x.dist,
    elev: x.elev,
    windSpeed: x.windSpeed,
    windCorr: x.windCorr,
    hits: x.hits,
    shots: x.shots,
    group: x.group,
    offUp: x.offUp,
    offRight: x.offRight,
    note: x.note,
    ...(skip ? { skip: true, skipReason: x.skipReason } : {}),
  });
}

/**
 * The `cold` flag becomes `session.coldShot`. A one-shot cold series was the cold shot
 * itself and is removed; in a longer series the first shot is marked, with the series'
 * group centre as an approximation. A session has one cold shot, so any further cold
 * series stay excluded from the card as they were.
 */
function convertCold(
  series: Raw[],
  photos: PhotoRef[],
): { series: Raw[]; photos: PhotoRef[]; coldShot?: ColdShot; extra: number } {
  const index = series.findIndex((x) => x.cold);
  if (index < 0) return { series, photos, extra: 0 };

  let extra = 0;
  const marked = series.map((x, i) => {
    if (!x.cold || i === index) return x;
    extra++;
    return { ...x, skip: true, skipReason: x.skipReason || COLD_REASON };
  });
  const cold = series[index];
  const offsets = { si: index, offUp: cold.offUp, offRight: cold.offRight };
  if (cold.shots !== 1) return { series: marked, photos, coldShot: offsets, extra };

  return {
    series: marked.filter((_, i) => i !== index),
    photos: photos.map((photo) => {
      if (photo.si === index) return { id: photo.id };
      return photo.si != null && photo.si > index ? { ...photo, si: photo.si - 1 } : photo;
    }),
    coldShot: { ...offsets, standalone: { ammoId: cold.ammoId, dist: cold.dist } },
    extra,
  };
}

function toSession(id: string, s: Raw, rifleMaps: Map<string, ReturnType<typeof migrateRifle>>) {
  const migrated = rifleMaps.get(s.rifleId);
  const legacyAmmo =
    s.ammoId ??
    (migrated?.loadMap && !Array.isArray(s.series)
      ? (migrated.loadMap[s.loadId] ?? migrated.loadMap[migrated.firstLoad as string])
      : undefined);
  const raw = flatSeries({ ...s, ammoId: legacyAmmo });
  const refs: PhotoRef[] = (s.photos ?? []).map((p: Raw) =>
    p.si == null ? { id: p.id } : { id: p.id, si: p.si },
  );
  const converted = convertCold(raw, refs);
  const createdAt = stamp(s.created);
  const rezero =
    s.rezero && typeof s.rezero === 'object'
      ? compact({ dist: s.rezero.dist, ammoId: s.rezero.ammoId || legacyAmmo })
      : undefined;
  const session: Session = compact({
    id,
    createdAt,
    updatedAt: createdAt,
    rifleId: s.rifleId,
    date: s.date,
    place: s.place,
    temp: s.temp,
    pressure: s.pressure,
    altitude: s.altitude,
    notes: s.notes,
    extraRounds: extraRounds(s, raw),
    rezero,
    coldShot: converted.coldShot,
    photos: converted.photos,
    series: converted.series.map(toSeries),
  });
  return { session, extra: converted.extra };
}

/** Converts the `docs` of a version 1 export to the current model. */
export function convertLegacyDocs(docs: Record<string, Raw>): LegacyResult {
  const entries = Object.entries(docs);
  const rifleMaps = new Map<string, ReturnType<typeof migrateRifle>>();
  const rifles: Rifle[] = [];
  const ammo: Ammo[] = [];

  for (const [id, r] of entries) {
    if (r.kind !== 'rifle') continue;
    const migrated = migrateRifle(id, r);
    rifleMaps.set(id, migrated);
    ammo.push(...migrated.ammo);
    const createdAt = stamp(r.created);
    rifles.push(
      compact({
        id,
        createdAt,
        updatedAt: createdAt,
        name: r.name,
        caliber: r.caliber ?? r.cartridge,
        barrel: r.barrel,
        units: r.units === 'MOA' ? ('MOA' as const) : ('MIL' as const),
        click: r.click,
        sightHeight: r.sightHeight,
        scope: r.scope,
        devices: r.devices,
        notes: r.notes,
        combos: migrated.combos,
      }),
    );
  }

  for (const [id, a] of entries) {
    if (a.kind !== 'ammo') continue;
    const createdAt = stamp(a.created);
    ammo.push(
      compact({
        id,
        createdAt,
        updatedAt: createdAt,
        type: a.type === 'handload' ? ('handload' as const) : ('factory' as const),
        name: a.name,
        caliber: a.caliber,
        notes: a.notes,
        bullet: a.bullet,
        maker: a.maker,
        line: a.line,
        lot: a.lot,
        powder: a.powder,
        charge: a.charge,
        chargeUnit: a.chargeUnit,
        brass: a.brass,
        primer: a.primer,
        coal: a.coal,
      }),
    );
  }

  const sessions: Session[] = [];
  let extraColdSeries = 0;
  for (const [id, s] of entries) {
    if (s.kind !== 'session') continue;
    const { session, extra } = toSession(id, s, rifleMaps);
    sessions.push(session);
    extraColdSeries += extra;
  }
  return { rifles, ammo, sessions, extraColdSeries };
}
