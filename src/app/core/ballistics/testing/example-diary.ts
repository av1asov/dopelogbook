import { Ammo, Diary, Rifle, Scope, Series, Session } from '../model';

const STAMP = '2026-01-01T00:00:00.000Z';
const meta = (id: string) => ({ id, createdAt: STAMP, updatedAt: STAMP });

export const HAND = 'ammo-hand';
export const FACTORY = 'ammo-factory';
export const RIFLE = 'rifle-1';
export const SCOPE = 'scope-1';

export const scope: Scope = {
  ...meta(SCOPE),
  name: 'Пример: оптика',
  type: 'optic',
  units: 'MRAD',
  click: 0.1,
};

export const rifle: Rifle = {
  ...meta(RIFLE),
  name: 'Пример: болтовка .308',
  caliber: '.308 Win',
  mounts: [{ scopeId: SCOPE, sightHeight: 45, mounted: true }],
  devices: ['ДТК', 'Глушитель'],
  combos: [
    { ammoId: HAND, velocity: 790 },
    { ammoId: FACTORY, velocity: 765 },
  ],
};

const hand: Ammo = {
  ...meta(HAND),
  type: 'handload',
  name: 'Тренировочный 175',
  caliber: '.308 Win',
};

const factory: Ammo = {
  ...meta(FACTORY),
  type: 'factory',
  caliber: '.308 Win',
  maker: 'Sellier & Bellot',
  line: 'SPCE',
};

const dtk = (x: Partial<Series>): Series => ({
  kind: 'normal',
  scopeId: SCOPE,
  ammoId: HAND,
  device: 'ДТК',
  pos: 'prone',
  rest: 'bipod',
  ...x,
});

const suppressed = (x: Partial<Series>): Series => ({
  kind: 'normal',
  scopeId: SCOPE,
  ammoId: FACTORY,
  device: 'Глушитель',
  pos: 'sit',
  rest: 'bench',
  ...x,
});

const sessions: Session[] = [
  {
    ...meta('s1'),
    rifleId: RIFLE,
    date: '2026-09-14',
    temp: 18,
    pressure: 748,
    extraRounds: 13,
    zeroEvents: [{ afterSi: -1, dist: 100, ammoId: HAND, scopeId: SCOPE }],
    series: [
      dtk({ dist: 100, elev: 0, hits: 5, shots: 5, group: 24 }),
      dtk({ dist: 200, elev: 0.9, windSpeed: 3, windCorr: 0.2, hits: 4, shots: 5 }),
      dtk({ dist: 300, elev: 2.0, windSpeed: 3, windCorr: 0.5, hits: 3, shots: 3, group: 95 }),
      dtk({
        dist: 300,
        elev: 2.3,
        windSpeed: 3,
        windCorr: 0.5,
        hits: 1,
        shots: 3,
        skip: true,
        skipReason: 'плохой упор, сорвал два выстрела',
      }),
      dtk({ dist: 400, elev: 3.1, windSpeed: 4, windCorr: 0.9, hits: 2, shots: 4 }),
    ],
  },
  {
    ...meta('s2'),
    rifleId: RIFLE,
    date: '2026-10-05',
    temp: 9,
    pressure: 752,
    extraRounds: 13,
    series: [
      dtk({ dist: 400, elev: 3.2, windSpeed: 2, windCorr: 0.45, hits: 3, shots: 3, offUp: -10 }),
      dtk({
        dist: 500,
        elev: 4.5,
        windSpeed: 2,
        windCorr: 0.6,
        hits: 3,
        shots: 4,
        group: 170,
        offUp: -50,
        offRight: 15,
      }),
      dtk({ dist: 600, elev: 5.9, windSpeed: 3, windCorr: 1.1, hits: 2, shots: 4 }),
      dtk({ dist: 700, elev: 7.6, windSpeed: 3, windCorr: 1.3, hits: 0, shots: 3 }),
      dtk({
        dist: 200,
        elev: 0.9,
        windSpeed: 2,
        windCorr: 0.3,
        hits: 4,
        shots: 5,
        group: 260,
        offUp: 50,
        pos: 'stand',
        rest: 'tripod',
      }),
      dtk({
        dist: 200,
        elev: 0.9,
        windSpeed: 2,
        windCorr: 0.3,
        hits: 3,
        shots: 5,
        group: 300,
        offUp: 40,
        pos: 'stand',
        rest: 'tripod',
      }),
      dtk({ dist: 100, elev: 0, hits: 4, shots: 5, group: 210, pos: 'kneel', rest: 'sling' }),
    ],
  },
  {
    ...meta('s3'),
    rifleId: RIFLE,
    date: '2026-10-12',
    temp: 11,
    pressure: 750,
    extraRounds: 0,
    // In the old format the cold shot was its own one-shot series at index 1.
    coldShot: { si: 1, offUp: 25, offRight: -10, standalone: { ammoId: FACTORY, dist: 100 } },
    series: [
      dtk({ dist: 100, elev: 0, hits: 5, shots: 5, group: 27, pos: 'sit', rest: 'bench' }),
      suppressed({ dist: 100, elev: 0.2, hits: 3, shots: 3, group: 41 }),
      suppressed({
        dist: 200,
        elev: 1.2,
        windSpeed: 2,
        windCorr: 0.2,
        hits: 3,
        shots: 3,
        group: 88,
      }),
      suppressed({ dist: 300, elev: 2.5, windSpeed: 2, windCorr: 0.35, hits: 2, shots: 3 }),
    ],
  },
];

export const exampleDiary: Diary = {
  scopes: [scope],
  rifles: [rifle],
  ammo: [hand, factory],
  sessions,
};
