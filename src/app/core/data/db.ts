import Dexie, { Table } from 'dexie';
import { Ammo, Doc, Rifle, Scope, Session } from '../ballistics/model';
import { migrateToScopes, RifleV2, SessionV2 } from './scope-migration';

export interface StoredPhoto extends Doc {
  blob: Blob;
}

export interface Setting {
  key: string;
  value: unknown;
}

/** Everything a backup holds, soft-deleted documents included. */
export interface Snapshot {
  scopes: Scope[];
  rifles: Rifle[];
  ammo: Ammo[];
  sessions: Session[];
  photos: StoredPhoto[];
}

export class DiaryDb extends Dexie {
  declare scopes: Table<Scope, string>;
  declare rifles: Table<Rifle, string>;
  declare ammo: Table<Ammo, string>;
  declare sessions: Table<Session, string>;
  declare photos: Table<StoredPhoto, string>;
  declare settings: Table<Setting, string>;

  constructor(name = 'dope') {
    super(name);
    this.version(1).stores({
      rifles: 'id',
      ammo: 'id',
      sessions: 'id, rifleId, date',
      photos: 'id',
      settings: 'key',
    });
    this.version(2)
      .stores({ scopes: 'id' })
      .upgrade(async (tx) => {
        const rifles = await tx.table<RifleV2, string>('rifles').toArray();
        const sessions = await tx.table<SessionV2, string>('sessions').toArray();
        const migrated = migrateToScopes(rifles, sessions);
        await tx.table('scopes').bulkPut(migrated.scopes);
        await tx.table('rifles').bulkPut(migrated.rifles);
        await tx.table('sessions').bulkPut(migrated.sessions);
      });
  }
}
