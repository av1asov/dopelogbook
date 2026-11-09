import { inject, Injectable, InjectionToken } from '@angular/core';
import { Table } from 'dexie';
import { Ammo, Diary, Doc, Rifle, Scope, Session } from '../ballistics/model';
import { DiaryDb, Snapshot, StoredPhoto } from './db';

export const DIARY_DB = new InjectionToken<DiaryDb>('DIARY_DB', {
  providedIn: 'root',
  factory: () => new DiaryDb(),
});

export interface DocByKind {
  scope: Scope;
  rifle: Rifle;
  ammo: Ammo;
  session: Session;
}

export type DocKind = keyof DocByKind;

/** A document to save: the id and timestamps are filled in when absent. */
export type DocInput<K extends DocKind> = Omit<DocByKind[K], keyof Doc> & Partial<Doc>;

export type RestoreMode = 'replace' | 'add';

const isLive = (doc: Doc): boolean => !doc.deletedAt;
const now = (): string => new Date().toISOString();

/** The only module that touches IndexedDB. */
@Injectable({ providedIn: 'root' })
export class DiaryRepository {
  private readonly db = inject(DIARY_DB);

  private table<K extends DocKind>(kind: K): Table<DocByKind[K], string> {
    const tables = {
      scope: this.db.scopes,
      rifle: this.db.rifles,
      ammo: this.db.ammo,
      session: this.db.sessions,
    };
    return tables[kind] as unknown as Table<DocByKind[K], string>;
  }

  async get<K extends DocKind>(kind: K, id: string): Promise<DocByKind[K] | undefined> {
    const doc = await this.table(kind).get(id);
    return doc && isLive(doc) ? doc : undefined;
  }

  async list<K extends DocKind>(kind: K): Promise<DocByKind[K][]> {
    return (await this.table(kind).toArray()).filter(isLive);
  }

  async put<K extends DocKind>(kind: K, input: DocInput<K>): Promise<DocByKind[K]> {
    const stamp = now();
    const doc = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: input.createdAt ?? stamp,
      updatedAt: stamp,
    } as DocByKind[K];
    await this.table(kind).put(doc);
    return doc;
  }

  /** Soft delete. A session's photos go with it. */
  async delete(kind: DocKind, id: string): Promise<void> {
    const deletedAt = now();
    const stamp = { deletedAt, updatedAt: deletedAt };
    const { db } = this;
    await db.transaction('rw', db.scopes, db.rifles, db.ammo, db.sessions, db.photos, async () => {
      const doc = await this.table(kind).get(id);
      if (!doc) return;
      await this.table(kind).update(id, stamp as never);
      const photos = kind === 'session' ? ((doc as Session).photos ?? []) : [];
      await db.photos.bulkUpdate(photos.map((p) => ({ key: p.id, changes: stamp })));
    });
  }

  async diary(): Promise<Diary> {
    const [scopes, rifles, ammo, sessions] = await Promise.all([
      this.list('scope'),
      this.list('rifle'),
      this.list('ammo'),
      this.list('session'),
    ]);
    return { scopes, rifles, ammo, sessions };
  }

  async putPhoto(blob: Blob, id: string = crypto.randomUUID()): Promise<string> {
    const stamp = now();
    const existing = await this.db.photos.get(id);
    await this.db.photos.put({
      id,
      blob,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    });
    return id;
  }

  async getPhoto(id: string): Promise<Blob | undefined> {
    const photo = await this.db.photos.get(id);
    return photo && isLive(photo) ? photo.blob : undefined;
  }

  async deletePhoto(id: string): Promise<void> {
    const deletedAt = now();
    await this.db.photos.update(id, { deletedAt, updatedAt: deletedAt });
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    return (await this.db.settings.get(key))?.value as T | undefined;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  async storedPhotoCount(): Promise<number> {
    return (await this.db.photos.toArray()).filter(isLive).length;
  }

  async snapshot(): Promise<Snapshot> {
    const { scopes, rifles, ammo, sessions, photos } = this.db;
    const [c, r, a, s, p] = await Promise.all([
      scopes.toArray(),
      rifles.toArray(),
      ammo.toArray(),
      sessions.toArray(),
      photos.toArray(),
    ]);
    return { scopes: c, rifles: r, ammo: a, sessions: s, photos: p };
  }

  /**
   * Runs in one transaction, so a failed import leaves the diary untouched.
   * `add` merges by id and keeps whichever copy was changed last.
   */
  async restore(snapshot: Snapshot, mode: RestoreMode): Promise<void> {
    const { db } = this;
    await db.transaction('rw', db.scopes, db.rifles, db.ammo, db.sessions, db.photos, async () => {
      await this.restoreTable(db.scopes, snapshot.scopes, mode);
      await this.restoreTable(db.rifles, snapshot.rifles, mode);
      await this.restoreTable(db.ammo, snapshot.ammo, mode);
      await this.restoreTable(db.sessions, snapshot.sessions, mode);
      await this.restoreTable<StoredPhoto>(db.photos, snapshot.photos, mode);
    });
  }

  private async restoreTable<T extends Doc>(
    table: Table<T, string>,
    incoming: T[],
    mode: RestoreMode,
  ): Promise<void> {
    if (mode === 'replace') {
      await table.clear();
      await table.bulkPut(incoming);
      return;
    }
    const current = new Map((await table.toArray()).map((doc) => [doc.id, doc]));
    await table.bulkPut(
      incoming.filter((doc) => {
        const existing = current.get(doc.id);
        return !existing || doc.updatedAt > existing.updatedAt;
      }),
    );
  }
}
