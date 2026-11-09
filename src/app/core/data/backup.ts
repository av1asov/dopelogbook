import { Ammo, Doc, Rifle, Scope, Session, TargetTemplate } from '../ballistics/model';
import { Snapshot, StoredPhoto } from './db';
import { convertLegacyDocs } from './legacy';
import { migrateToScopes, RifleV2, SessionV2 } from './scope-migration';

const FORMAT = 'dope-diary';
const CURRENT_VERSION = 3;

export class BackupError extends Error {}

export interface BackupWarnings {
  /** Cold series beyond the first in a session: kept, but excluded from the card. */
  extraColdSeries: number;
  /** Photos a session refers to that the file lacks or holds in a damaged form. */
  missingPhotos: number;
}

export interface ParsedBackup {
  snapshot: Snapshot;
  warnings: BackupWarnings;
}

export interface BackupSummary {
  rifles: number;
  ammo: number;
  sessions: number;
  photos: number;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)((?:;[^,]*)*),(.*)$/s.exec(dataUrl);
  if (!match) throw new BackupError('Повреждённое фото в файле.');
  const [, type, params, payload] = match;
  if (!/;base64/i.test(params)) {
    return new Blob([decodeURIComponent(payload)], { type });
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const summarizeLive = <T extends Doc>(docs: T[]): number => docs.filter((d) => !d.deletedAt).length;

export function summarize(snapshot: Snapshot): BackupSummary {
  return {
    rifles: summarizeLive(snapshot.rifles),
    ammo: summarizeLive(snapshot.ammo),
    sessions: summarizeLive(snapshot.sessions),
    photos: summarizeLive(snapshot.photos),
  };
}

function parsePhotoV1(id: string, dataUrl: unknown, stamp: string): StoredPhoto | null {
  try {
    return { id, blob: dataUrlToBlob(dataUrl as string), createdAt: stamp, updatedAt: stamp };
  } catch {
    return null;
  }
}

function dropMissingPhotos(sessions: Pick<Session, 'photos'>[], photos: StoredPhoto[]): number {
  const known = new Set(photos.map((p) => p.id));
  let missing = 0;
  for (const session of sessions) {
    if (!session.photos) continue;
    const present = session.photos.filter((p) => known.has(p.id));
    missing += session.photos.length - present.length;
    session.photos = present;
  }
  return missing;
}

function parseV1(file: Record<string, unknown>): ParsedBackup {
  const stamp =
    typeof file['exportedAt'] === 'string' ? file['exportedAt'] : new Date(0).toISOString();
  const legacy = convertLegacyDocs(file['docs'] as Record<string, unknown>);
  const photos = Object.entries((file['photos'] ?? {}) as Record<string, unknown>).flatMap(
    ([id, dataUrl]) => parsePhotoV1(id, dataUrl, stamp) ?? [],
  );
  const missingPhotos = dropMissingPhotos(legacy.sessions, photos);
  return {
    snapshot: {
      ...migrateToScopes(legacy.rifles, legacy.sessions),
      ammo: legacy.ammo,
      photos,
      targets: [],
    },
    warnings: { extraColdSeries: legacy.extraColdSeries, missingPhotos },
  };
}

interface StoredDoc extends Doc {
  kind: 'scope' | 'rifle' | 'ammo' | 'session' | 'target';
}

/** Version 2 kept the scope on the rifle; everything else reads the same as version 3. */
function parseDocs(file: Record<string, unknown>): ParsedBackup {
  const snapshot: Snapshot = {
    scopes: [],
    rifles: [],
    ammo: [],
    sessions: [],
    photos: [],
    targets: [],
  };
  for (const raw of Object.values(file['docs'] as Record<string, StoredDoc>)) {
    const { kind, ...doc } = raw;
    if (kind === 'scope') snapshot.scopes.push(doc as unknown as Scope);
    if (kind === 'rifle') snapshot.rifles.push(doc as unknown as Rifle);
    if (kind === 'ammo') snapshot.ammo.push(doc as unknown as Ammo);
    if (kind === 'session') snapshot.sessions.push(doc as unknown as Session);
    if (kind === 'target') snapshot.targets.push(doc as unknown as TargetTemplate);
  }
  if (file['version'] === 2) {
    Object.assign(
      snapshot,
      migrateToScopes(
        snapshot.rifles as unknown as RifleV2[],
        snapshot.sessions as unknown as SessionV2[],
      ),
    );
  }
  const photos = (file['photos'] ?? {}) as Record<string, Omit<Doc, 'id'> & { data: string }>;
  let damaged = 0;
  for (const [id, { data, ...meta }] of Object.entries(photos)) {
    try {
      snapshot.photos.push({ ...meta, id, blob: dataUrlToBlob(data) });
    } catch {
      damaged++;
    }
  }
  return {
    snapshot,
    warnings: {
      extraColdSeries: 0,
      missingPhotos: damaged + dropMissingPhotos(snapshot.sessions, snapshot.photos),
    },
  };
}

export function parseBackup(text: string): ParsedBackup {
  let file: Record<string, unknown>;
  try {
    file = JSON.parse(text);
  } catch {
    throw new BackupError('Файл не читается: это не JSON.');
  }
  if (file?.['format'] !== FORMAT || typeof file['docs'] !== 'object' || !file['docs']) {
    throw new BackupError('Это не резервная копия дневника.');
  }
  if (file['version'] === 1) return parseV1(file);
  if (file['version'] === 2 || file['version'] === CURRENT_VERSION) return parseDocs(file);
  throw new BackupError(`Неизвестная версия файла: ${String(file['version'])}.`);
}

/** Built from parts: joining every photo into one string can exhaust memory on a phone. */
export async function buildBackup(snapshot: Snapshot, exportedAt: string): Promise<Blob> {
  const docs: Record<string, object> = {};
  for (const c of snapshot.scopes) docs[c.id] = { ...c, kind: 'scope' };
  for (const r of snapshot.rifles) docs[r.id] = { ...r, kind: 'rifle' };
  for (const a of snapshot.ammo) docs[a.id] = { ...a, kind: 'ammo' };
  for (const s of snapshot.sessions) docs[s.id] = { ...s, kind: 'session' };
  for (const t of snapshot.targets) docs[t.id] = { ...t, kind: 'target' };

  const parts: string[] = [
    `{"format":"${FORMAT}","version":${CURRENT_VERSION},"exportedAt":${JSON.stringify(exportedAt)},`,
    `"docs":${JSON.stringify(docs)},"photos":{`,
  ];
  let first = true;
  for (const { id, blob, ...meta } of snapshot.photos) {
    const data = await blobToDataUrl(blob);
    const entry = JSON.stringify({ ...meta, data });
    parts.push(`${first ? '' : ','}${JSON.stringify(id)}:${entry}`);
    first = false;
  }
  parts.push('}}');
  return new Blob(parts, { type: 'application/json' });
}
