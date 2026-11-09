import { TargetReference, TargetRing, TargetTemplate } from '../../ballistics/model';
import { ringsReference, SHEETS } from '../measure';

const STAMP = '2026-11-09T00:00:00.000Z';
const stamp = { createdAt: STAMP, updatedAt: STAMP } as const;
const CENTRE = { up: 0, right: 0 };
const A4 = SHEETS[0][1];

/** Templates for the tests; the app ships with none. */
const SKILLED_RINGS: TargetRing[] = [
  { edge: 'light-disc', d: 29, label: '1 MOA@100 м' },
  { edge: 'light-ring', dIn: 51.8, dOut: 58.8, label: '≈2 MOA' },
  { edge: 'dark-disc', d: 87.4, label: '3 MOA@100 м' },
];

export const TEST_TARGETS: readonly TargetTemplate[] = [
  {
    ...stamp,
    id: 'builtin-grid-25',
    name: 'Сетка 25 мм с квадратом',
    sheet: A4,
    targets: [{ n: 1, x: 105, y: 148.5, reference: { kind: 'square', size: 25 }, aim: CENTRE }],
  },
  {
    ...stamp,
    id: 'builtin-rings',
    name: 'Кольцевая',
    sheet: A4,
    targets: [
      {
        n: 1,
        x: 105,
        y: 148.5,
        reference: { kind: 'rings', diameters: [40, 80, 130, 180] },
        aim: CENTRE,
      },
    ],
  },
  {
    ...stamp,
    id: 'builtin-four-squares',
    name: '4 квадрата на A4',
    sheet: A4,
    targets: [
      [55, 80],
      [155, 80],
      [55, 217],
      [155, 217],
    ].map(([x, y], i) => ({
      n: i + 1,
      x,
      y,
      reference: { kind: 'square', size: 30 } as TargetReference,
      aim: CENTRE,
    })),
  },
  {
    ...stamp,
    id: 'std-skilled-3moa-100',
    name: 'Skilled Shooting · 3 MOA · 100 м',
    sheet: A4,
    artSize: { w: 210, h: 210 },
    numbering: 'printed',
    targets: [
      [58.4, 58.5],
      [151.5, 58.5],
      [58.4, 151.5],
      [151.5, 151.5],
    ].map(([x, y], i) => ({
      n: i + 1,
      x,
      y,
      reference: ringsReference(SKILLED_RINGS),
      aim: CENTRE,
    })),
  },
];
