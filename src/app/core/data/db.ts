import Dexie, { Table } from 'dexie';
import { Ammo, Doc, Rifle, Session } from '../ballistics/model';

export interface StoredPhoto extends Doc {
  blob: Blob;
}

export interface Setting {
  key: string;
  value: unknown;
}

/** Everything a backup holds, soft-deleted documents included. */
export interface Snapshot {
  rifles: Rifle[];
  ammo: Ammo[];
  sessions: Session[];
  photos: StoredPhoto[];
}

export class DiaryDb extends Dexie {
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
  }
}
