import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Diary, Session } from '../ballistics/model';
import golden from '../ballistics/testing/example.golden.json';
import { goldenSnapshot } from '../ballistics/testing/golden-snapshot';
import exampleV1 from './testing/example.v1.json';
import Dexie from 'dexie';
import { BackupError, buildBackup, dataUrlToBlob, parseBackup, summarize } from './backup';
import { DiaryDb, Snapshot } from './db';
import { DIARY_DB, DiaryRepository } from './repository';

/* jsdom Blobs do not survive the structured clone fake-indexeddb performs. */
function cloneKeepingBlobs<T>(value: T): T {
  if (value instanceof Blob || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneKeepingBlobs) as T;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneKeepingBlobs(v)])) as T;
}

beforeAll(() => vi.stubGlobal('structuredClone', cloneKeepingBlobs));
afterAll(() => vi.unstubAllGlobals());

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const v1 = (docs: Record<string, unknown>, photos: Record<string, string> = {}) =>
  JSON.stringify({
    format: 'dope-diary',
    version: 1,
    exportedAt: '2026-11-01T00:00:00.000Z',
    docs,
    photos,
  });

const rifleDoc = {
  kind: 'rifle',
  name: 'R',
  units: 'MIL',
  combos: [{ ammoId: 'a', velocity: 800 }],
};
const ammoDoc = { kind: 'ammo', type: 'factory', name: 'A' };

const sessionOf = (doc: Record<string, unknown>): Session => {
  const { snapshot } = parseBackup(
    v1({
      r: rifleDoc,
      a: ammoDoc,
      s: { kind: 'session', rifleId: 'r', date: '2026-01-01', ...doc },
    }),
  );
  return snapshot.sessions[0];
};

const toDiary = ({ scopes, rifles, ammo, sessions }: Snapshot): Diary => ({
  scopes,
  rifles,
  ammo,
  sessions,
});

function exampleIds(snapshot: Snapshot) {
  const named = (name: string) => snapshot.ammo.find((a) => a.name === name || a.maker === name);
  return {
    rifle: snapshot.rifles[0].id,
    hand: named('Тренировочный 175')!.id,
    factory: named('Sellier & Bellot')!.id,
  };
}

describe('importing a version 1 export', () => {
  const { snapshot, warnings } = parseBackup(JSON.stringify(exampleV1));
  const actual = goldenSnapshot(toDiary(snapshot), exampleIds(snapshot));

  for (const key of Object.keys(golden)) {
    it(`matches the original diary: ${key}`, () => {
      expect(actual[key]).toEqual((golden as Record<string, unknown>)[key]);
    });
  }

  it('turns the one-shot cold series into the cold shot', () => {
    const session = snapshot.sessions.find((s) => s.date === '2026-10-12')!;
    expect(session.series).toHaveLength(4);
    expect(session.coldShot).toEqual({
      si: 1,
      offUp: 25,
      offRight: -10,
      standalone: { ammoId: exampleIds(snapshot).factory, dist: 100 },
    });
    expect(warnings).toEqual({ extraColdSeries: 0, missingPhotos: 0 });
  });

  it('counts what the file holds', () => {
    expect(summarize(snapshot)).toEqual({ rifles: 1, ammo: 2, sessions: 3, photos: 0 });
  });
});

describe('older record layouts', () => {
  it('reads a rifle with a loads list and a session bound to a load', () => {
    const { snapshot } = parseBackup(
      v1({
        r: {
          kind: 'rifle',
          name: 'Old',
          cartridge: '.308',
          loads: [
            { id: 'l1', name: 'First', velocity: 800 },
            { id: 'l2', name: 'Second', velocity: 790 },
          ],
        },
        s: {
          kind: 'session',
          rifleId: 'r',
          date: '2024-01-01',
          loadId: 'l2',
          rounds: 12,
          entries: [{ dist: 100, elev: 0, hits: 5, shots: 5, ok: false }],
        },
      }),
    );
    const rifle = snapshot.rifles[0];
    const [session] = snapshot.sessions;
    expect(snapshot.scopes[0].units).toBe('MRAD');
    expect(rifle.mounts).toEqual([{ scopeId: 'scope-r', mounted: true }]);
    expect(rifle.caliber).toBe('.308');
    expect(rifle.combos).toEqual([
      { ammoId: 'r-l1', velocity: 800 },
      { ammoId: 'r-l2', velocity: 790 },
    ]);
    expect(snapshot.ammo.map((a) => a.name)).toEqual(['First', 'Second']);
    expect(session.series[0].ammoId).toBe('r-l2');
    expect(session.series[0].skip).toBe(true);
    expect(session.extraRounds).toBe(7);
  });

  it('flattens series blocks with entries', () => {
    const session = sessionOf({
      series: [
        {
          ammoId: 'a',
          device: 'ДТК',
          entries: [
            { dist: 100, elev: 0 },
            { dist: 200, elev: 1 },
          ],
        },
      ],
    });
    expect(session.series).toEqual([
      { kind: 'normal', scopeId: 'scope-r', ammoId: 'a', device: 'ДТК', dist: 100, elev: 0 },
      { kind: 'normal', scopeId: 'scope-r', ammoId: 'a', device: 'ДТК', dist: 200, elev: 1 },
    ]);
  });
});

describe('cold barrel conversion', () => {
  const series = (x: object) => ({ ammoId: 'a', dist: 100, elev: 0, ...x });

  it('marks the first shot of a longer cold series and keeps the series', () => {
    const session = sessionOf({
      series: [series({ shots: 5, hits: 5, cold: true, offUp: 20, offRight: 5 })],
    });
    expect(session.series).toHaveLength(1);
    expect(session.series[0]).not.toHaveProperty('cold');
    expect(session.coldShot).toEqual({ si: 0, offUp: 20, offRight: 5 });
  });

  it('leaves further cold series out of the card', () => {
    const { snapshot, warnings } = parseBackup(
      v1({
        r: rifleDoc,
        a: ammoDoc,
        s: {
          kind: 'session',
          rifleId: 'r',
          date: '2026-01-01',
          series: [series({ shots: 1, cold: true }), series({ shots: 1, cold: true })],
        },
      }),
    );
    expect(snapshot.sessions[0].series).toEqual([
      {
        kind: 'normal',
        scopeId: 'scope-r',
        ammoId: 'a',
        dist: 100,
        elev: 0,
        shots: 1,
        skip: true,
        skipReason: 'холодный ствол, учитывается отдельно',
      },
    ]);
    expect(warnings.extraColdSeries).toBe(1);
  });
});

describe('moving to separate scopes', () => {
  const stamp = '2026-11-01T00:00:00.000Z';
  const rifleV2 = {
    id: 'r',
    createdAt: stamp,
    updatedAt: stamp,
    name: 'R',
    scope: 'Artelv CRS',
    units: 'MOA',
    click: 0.25,
    sightHeight: 45,
    combos: [{ ammoId: 'a' }],
  };
  const sessionV2 = {
    id: 's',
    createdAt: stamp,
    updatedAt: stamp,
    rifleId: 'r',
    date: '2026-01-01',
    rezero: { dist: 100 },
    series: [{ ammoId: 'a', dist: 300, elev: 3.4377, windCorr: 1.71885, shots: 5 }],
  };

  const check = ({
    scopes,
    rifles,
    sessions,
  }: Pick<Snapshot, 'scopes' | 'rifles' | 'sessions'>) => {
    expect(scopes).toEqual([
      {
        id: 'scope-r',
        createdAt: stamp,
        updatedAt: stamp,
        name: 'Artelv CRS',
        type: 'optic',
        units: 'MOA',
        click: 0.25,
      },
    ]);
    expect(rifles[0].mounts).toEqual([{ scopeId: 'scope-r', sightHeight: 45, mounted: true }]);
    expect(rifles[0]).not.toHaveProperty('units');
    expect(rifles[0]).not.toHaveProperty('scope');
    const [session] = sessions;
    expect(session).not.toHaveProperty('rezero');
    expect(session.zeroEvents).toEqual([
      { afterSi: -1, dist: 100, ammoId: 'a', scopeId: 'scope-r' },
    ]);
    expect(session.series[0].kind).toBe('normal');
    expect(session.series[0].scopeId).toBe('scope-r');
    expect(session.series[0].elev).toBeCloseTo(1, 9);
    expect(session.series[0].windCorr).toBeCloseTo(0.5, 9);
  };

  it('reads a version 2 file', () => {
    const docs = {
      r: { ...rifleV2, kind: 'rifle' },
      a: { id: 'a', createdAt: stamp, updatedAt: stamp, kind: 'ammo', type: 'factory' },
      s: { ...sessionV2, kind: 'session' },
    };
    check(parseBackup(JSON.stringify({ format: 'dope-diary', version: 2, docs })).snapshot);
  });

  it('turns MIL into MRAD and leaves the numbers alone', () => {
    const { snapshot } = parseBackup(
      v1({
        r: { ...rifleDoc, click: 0.1 },
        a: ammoDoc,
        s: {
          kind: 'session',
          rifleId: 'r',
          date: '2026-01-01',
          series: [{ ammoId: 'a', elev: 2.3 }],
        },
      }),
    );
    expect(snapshot.scopes[0].units).toBe('MRAD');
    expect(snapshot.sessions[0].series[0].elev).toBe(2.3);
  });

  it('upgrades a diary already on the device', async () => {
    const name = 'upgrade-test';
    const old = new Dexie(name);
    old.version(1).stores({
      rifles: 'id',
      ammo: 'id',
      sessions: 'id, rifleId, date',
      photos: 'id',
      settings: 'key',
    });
    await old.open();
    await old.table('rifles').put(rifleV2);
    await old.table('sessions').put(sessionV2);
    old.close();

    const db = new DiaryDb(name);
    await db.open();
    check({
      scopes: await db.scopes.toArray(),
      rifles: await db.rifles.toArray(),
      sessions: await db.sessions.toArray(),
    });
    await db.delete();
  });
});

describe('photos in a backup', () => {
  it('decodes a data URL', async () => {
    const blob = dataUrlToBlob(PIXEL);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(50);
  });

  it('links photos and shifts them around a removed cold series', () => {
    const { snapshot, warnings } = parseBackup(
      v1(
        {
          r: rifleDoc,
          a: ammoDoc,
          s: {
            kind: 'session',
            rifleId: 'r',
            date: '2026-01-01',
            series: [
              { ammoId: 'a', dist: 100, shots: 1, cold: true },
              { ammoId: 'a', dist: 100, shots: 3 },
            ],
            photos: [{ id: 'on-cold', si: 0 }, { id: 'on-next', si: 1 }, { id: 'absent' }],
          },
        },
        { 'on-cold': PIXEL, 'on-next': PIXEL, broken: 'not a data url' },
      ),
    );
    expect(snapshot.sessions[0].photos).toEqual([{ id: 'on-cold' }, { id: 'on-next', si: 0 }]);
    expect(snapshot.photos.map((p) => p.id)).toEqual(['on-cold', 'on-next']);
    expect(warnings.missingPhotos).toBe(1);
  });
});

describe('rejected files', () => {
  it.each([
    ['not json', 'nonsense'],
    ['another format', '{"format":"other","docs":{}}'],
    ['a newer version', '{"format":"dope-diary","version":99,"docs":{}}'],
  ])('%s', (_, text) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
  });
});

describe('repository', () => {
  let db: DiaryDb;
  let repository: DiaryRepository;
  let counter = 0;

  beforeEach(() => {
    db = new DiaryDb(`test-${counter++}`);
    TestBed.configureTestingModule({ providers: [{ provide: DIARY_DB, useValue: db }] });
    repository = TestBed.inject(DiaryRepository);
  });

  afterEach(async () => {
    await db.delete();
  });

  const newSession = { rifleId: 'r', date: '2026-01-01', series: [] };

  it('fills in the id and timestamps', async () => {
    const saved = await repository.put('session', newSession);
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.createdAt).toBe(saved.updatedAt);
    expect(await repository.get('session', saved.id)).toEqual(saved);
  });

  it('keeps createdAt and bumps updatedAt on save', async () => {
    const saved = await repository.put('session', {
      ...newSession,
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    expect(saved.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(saved.updatedAt > saved.createdAt).toBe(true);
  });

  it('hides soft-deleted documents but keeps them for backups', async () => {
    const saved = await repository.put('session', newSession);
    await repository.delete('session', saved.id);
    expect(await repository.get('session', saved.id)).toBeUndefined();
    expect(await repository.list('session')).toEqual([]);
    const { sessions } = await repository.snapshot();
    expect(sessions[0].deletedAt).toBeTruthy();
  });

  it('deletes the photos of a deleted session', async () => {
    const photoId = await repository.putPhoto(new Blob(['x'], { type: 'image/jpeg' }));
    const saved = await repository.put('session', { ...newSession, photos: [{ id: photoId }] });
    await repository.delete('session', saved.id);
    expect(await repository.getPhoto(photoId)).toBeUndefined();
    expect(await repository.storedPhotoCount()).toBe(0);
  });

  it('stores settings', async () => {
    await repository.setSetting('unit', 'MOA');
    expect(await repository.getSetting('unit')).toBe('MOA');
    expect(await repository.getSetting('absent')).toBeUndefined();
  });

  describe('backup round trip', () => {
    async function fill() {
      const photo = dataUrlToBlob(PIXEL);
      const photoId = await repository.putPhoto(photo);
      await repository.put('ammo', { id: 'a', type: 'factory', name: 'A' });
      await repository.put('scope', { id: 'c', name: 'C', type: 'optic', units: 'MRAD' });
      await repository.put('rifle', {
        id: 'r',
        name: 'R',
        combos: [{ ammoId: 'a' }],
        mounts: [{ scopeId: 'c', mounted: true }],
      });
      await repository.put('session', {
        id: 's',
        rifleId: 'r',
        date: '2026-01-01',
        coldShot: { si: 0, offUp: 20 },
        photos: [{ id: photoId, si: 0 }],
        zeroEvents: [{ afterSi: -1, dist: 100, scopeId: 'c' }],
        series: [
          { kind: 'normal', scopeId: 'c', ammoId: 'a', dist: 100, elev: 0, shots: 5, hits: 5 },
        ],
      });
      return photoId;
    }

    async function exportText(): Promise<string> {
      const blob = await buildBackup(await repository.snapshot(), '2026-11-08T00:00:00.000Z');
      return blob.text();
    }

    it('restores everything after the data is gone, photos included', async () => {
      const photoId = await fill();
      const before = await repository.snapshot();
      const text = await exportText();

      await repository.restore(
        { scopes: [], rifles: [], ammo: [], sessions: [], photos: [] },
        'replace',
      );
      expect(await repository.diary()).toEqual({ scopes: [], rifles: [], ammo: [], sessions: [] });

      await repository.restore(parseBackup(text).snapshot, 'replace');
      const after = await repository.snapshot();
      expect(after.scopes).toEqual(before.scopes);
      expect(after.rifles).toEqual(before.rifles);
      expect(after.ammo).toEqual(before.ammo);
      expect(after.sessions).toEqual(before.sessions);
      const restored = await repository.getPhoto(photoId);
      expect(restored?.type).toBe('image/png');
      expect(restored?.size).toBe(dataUrlToBlob(PIXEL).size);
    });

    it('add keeps the copy changed last', async () => {
      await fill();
      const text = await exportText();
      const saved = (await repository.get('rifle', 'r'))!;
      await repository.put('rifle', { ...saved, name: 'Edited later' });
      await repository.restore(parseBackup(text).snapshot, 'add');
      expect((await repository.get('rifle', 'r'))?.name).toBe('Edited later');
    });

    it('add brings in documents the device lacks', async () => {
      await fill();
      const text = await exportText();
      await repository.restore(
        { scopes: [], rifles: [], ammo: [], sessions: [], photos: [] },
        'replace',
      );
      await repository.put('ammo', { id: 'other', type: 'factory', name: 'Other' });
      await repository.restore(parseBackup(text).snapshot, 'add');
      expect((await repository.list('ammo')).map((a) => a.id).sort()).toEqual(['a', 'other']);
    });
  });
});
