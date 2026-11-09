import { Point } from '../ballistics/model';
import { CleanSheet, DetectImage, detectTarget, MeasureResult, openCvReady } from './detect';
import { applyHomography, homography, rectangle } from './homography';
import { TEST_TARGETS } from './testing/templates';

type Cv = Parameters<typeof detectTarget>[0];
type Rgb = readonly [number, number, number];

interface NodeProcess {
  cwd(): string;
  getBuiltinModule(name: 'node:module'): { createRequire(path: string): (id: string) => unknown };
  getBuiltinModule(name: 'node:fs'): {
    existsSync(path: string): boolean;
    readFileSync(path: string): Uint8Array & { toString(): string };
  };
}

const { process } = globalThis as unknown as { process: NodeProcess };
const nodeRequire = process
  .getBuiltinModule('node:module')
  .createRequire(`${process.cwd()}/package.json`);
const cvModule = nodeRequire('@techstark/opencv-js');
const jpeg = nodeRequire('jpeg-js') as {
  decode(data: Uint8Array, options: { useTArray: boolean }): DetectImage;
};

const SKILLED = TEST_TARGETS.find((t) => t.id === 'std-skilled-3moa-100')!;
const CENTRES: Point[] = SKILLED.targets;
const A4 = { w: 210, h: 297 };
/** Where the 210 × 210 drawing lies on the A4 sheet. */
const ART_TOP = 43.5;
const CALIBRE = 7.82;
const CORE = 3.5;

const WHITE: Rgb = [240, 237, 230];
const BROWN: Rgb = [112, 92, 78];
const PAPER: Rgb = [232, 230, 224];
const TABLE: Rgb = [70, 66, 60];
const FIBRE: Rgb = [205, 190, 150];
const PEN: Rgb = [45, 60, 170];
const STEEL: Rgb = [190, 195, 200];
const SHIELDS: readonly Rgb[] = [
  [36, 30, 26],
  [150, 146, 140],
  [205, 200, 190],
];

function art({ x, y }: Point): Rgb | null {
  for (const c of CENTRES) {
    const [dx, dy] = [x - c.x, y - c.y];
    const r = Math.hypot(dx, dy);
    if (r >= 43.7) continue;
    if (r < 14.5) return Math.abs(dx) < 0.25 || Math.abs(dy) < 0.25 ? BROWN : WHITE;
    if (r > 25.9 && r < 29.4) return WHITE;
    const line =
      Math.abs(dx) < 0.35 ||
      Math.abs(dy) < 0.35 ||
      Math.abs(Math.abs(dx) - 28) < 0.3 ||
      Math.abs(Math.abs(dy) - 28) < 0.3;
    return line ? WHITE : BROWN;
  }
  return null;
}

const near = (n: number, dx: number, dy: number): Point => ({
  x: CENTRES[n].x + dx,
  y: CENTRES[n].y + dy,
});

/** On the field, in the white centre, on the white lines and across the edges of the rings. */
const HOLES: Point[] = [
  near(0, 16, 12),
  near(0, -20, 6),
  near(1, 18, -14),
  near(2, -18, -13),
  // These two touch, as holes in one group do.
  near(3, 18, 16),
  near(3, 25.2, 16),
  near(0, 4, -6),
  near(1, -5, 5),
  near(2, 6, 4),
  near(3, -4, -7),
  near(0, 28, -8),
  near(1, -28, 12),
  near(2, 9, 28),
  near(3, -13, 28),
  near(0, -18.4, -18.4),
  near(1, 20, 20),
  near(2, 26, 5),
  near(3, 5, -26),
  near(1, 0, -37),
  near(2, -38, 3),
];

const inHole = (at: Point, hole: Point) => Math.hypot(at.x - hole.x, at.y - hole.y);

/** The core shows the backing, with threads across it; around it the paper is torn in rays. */
function shotArt(at: Point, base: Rgb, shields: readonly Rgb[]): Rgb {
  for (let i = 0; i < HOLES.length; i++) {
    const r = inHole(at, HOLES[i]);
    if (r > 5.5) continue;
    const [dx, dy] = [at.x - HOLES[i].x, at.y - HOLES[i].y];
    if (r < CORE) return Math.abs(dx - dy * 0.3) < 0.25 ? FIBRE : shields[i % shields.length];
    const ray = Math.abs(Math.sin(Math.atan2(dy, dx) * 5)) < 0.12;
    return ray ? WHITE : base;
  }
  return base;
}

function isStaple({ x, y }: Point): boolean {
  const c = CENTRES[2];
  const [dx, dy] = [x - c.x, y - c.y];
  return (
    (Math.abs(dy + 28) < 0.35 && dx > -3 && dx < 9) ||
    (Math.abs(dx + 3) < 0.35 && dy > -33 && dy < -28) ||
    (Math.abs(dx - 9) < 0.35 && dy > -33 && dy < -28)
  );
}

const isInk = ({ x, y }: Point) => x < 12 && Math.abs(y - 50 - Math.sin(x) * 2) < 0.4;

/** What the printed drawing looks like, `at` in mm of the drawing. */
function drawing(at: Point, shields: readonly Rgb[] | null): Rgb {
  const base = art(at) ?? PAPER;
  if (!shields) return base;
  if (isStaple(at)) return STEEL;
  if (isInk(at)) return PEN;
  return shotArt(at, base, shields);
}

function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * 10;
  };
}

/** Which point of the sheet each pixel sees, under light falling off across the picture. */
function photograph(
  width: number,
  height: number,
  pixelToSheet: (px: number, py: number) => Point,
  paint: (mm: Point) => Rgb,
  light: (px: number) => number,
  seed = 7,
): DetectImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const jitter = noise(seed);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const colour = paint(pixelToSheet(px, py));
      const lit = light(px);
      const i = (py * width + px) * 4;
      const grain = jitter();
      data[i] = colour[0] * lit + grain;
      data[i + 1] = colour[1] * lit + grain;
      data[i + 2] = colour[2] * lit + grain;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const WIDTH = 1300;
const HEIGHT = 1700;
const TILTED: Point[] = [
  { x: 240, y: 170 },
  { x: 1090, y: 120 },
  { x: 1240, y: 1610 },
  { x: 70, y: 1560 },
];

function sheetPainter(shields: readonly Rgb[] | null) {
  return (mm: Point): Rgb => {
    if (mm.x < 0 || mm.y < 0 || mm.x > A4.w || mm.y > A4.h) return TABLE;
    return drawing({ x: mm.x, y: mm.y - ART_TOP }, shields);
  };
}

function shotOnTable(shields: readonly Rgb[] = SHIELDS): DetectImage {
  const matrix = homography(TILTED, rectangle(A4.w, A4.h))!;
  return photograph(
    WIDTH,
    HEIGHT,
    (x, y) => applyHomography(matrix, { x, y }),
    sheetPainter(shields),
    (px) => 1 - (0.2 * px) / WIDTH,
  );
}

/** Taken separately, in another light and without any tilt, as the template was. */
function cleanSheet(): CleanSheet {
  const [x0, y0, k] = [-6, -6, 5];
  const image = photograph(
    222 * k,
    222 * k,
    (x, y) => ({ x: x / k + x0, y: y / k + y0 }),
    (mm) => drawing(mm, null),
    (px) => 0.8 + (0.15 * px) / (222 * k),
    99,
  );
  return { image, x0, y0, k };
}

/** In millimetres of the drawing. */
function scored(result: MeasureResult) {
  const h = result.plane!.homography!;
  const offset = result.plane!.scale.sheet ? ART_TOP : 0;
  const found = result
    .targets!.flatMap((t) => t.holes.filter((hole) => !hole.doubtful))
    .map((p) => applyHomography(h, p))
    .map(({ x, y }) => ({ x, y: y - offset }));
  const gaps = HOLES.map((hole) => Math.min(...found.map((p) => inHole(p, hole))));
  const extra = found.filter((p) => !HOLES.some((hole) => inHole(p, hole) < 3));
  return { hits: gaps.filter((gap) => gap < 3), extra, count: gaps.filter((g) => g < 3).length };
}

describe('holes on coloured and dark fields', () => {
  let cv: Cv;

  beforeAll(async () => {
    ({ cv } = await openCvReady(cvModule));
  }, 60000);

  const measure = (image: DetectImage, clean: CleanSheet | null) =>
    detectTarget(cv, {
      kind: 'measure',
      image,
      template: SKILLED,
      manual: null,
      holeMm: CALIBRE,
      shots: null,
      clean,
    }) as MeasureResult;

  it(
    'with a clean sheet finds nearly every hole, on any colour, and nothing else',
    { timeout: 60000 },
    () => {
      const result = scored(measure(shotOnTable(), cleanSheet()));
      expect(result.count).toBeGreaterThanOrEqual(19);
      expect(result.extra.length).toBeLessThanOrEqual(1);
      for (const gap of result.hits) expect(gap).toBeLessThan(0.5);
    },
  );

  it('without a clean sheet still finds most of them on a dark backing', { timeout: 60000 }, () => {
    const result = scored(measure(shotOnTable([SHIELDS[0]]), null));
    expect(result.count).toBeGreaterThanOrEqual(17);
    expect(result.extra.length).toBeLessThanOrEqual(2);
  });

  // The spec asks for 17 of 20 on light and grey backing too; without a clean sheet a light hole
  // on a white ring cannot be told from the ring, so this one is still open.
  it.todo('without a clean sheet finds 17 of 20 on light and grey backing as well');

  it(
    'rectifies by the targets when the corners of the sheet are out of the shot',
    { timeout: 60000 },
    () => {
      const corners: Point[] = [
        { x: 60, y: -260 },
        { x: 1240, y: -260 },
        { x: 1240, y: 1400 },
        { x: 60, y: 1400 },
      ];
      const matrix = homography(corners, rectangle(A4.w, A4.h))!;
      const image = photograph(
        WIDTH,
        1000,
        (x, y) => applyHomography(matrix, { x, y }),
        sheetPainter(null),
        () => 1,
      );
      const result = measure(image, null);
      expect(result.plane?.scale.source).toBe('targets');
      expect(result.targets?.flatMap((t) => t.holes)).toEqual([]);
    },
  );
});

/** Real photos of the owner's targets stay out of the public repository. */
describe('a real photo of a Skilled Shooting target', () => {
  const { existsSync, readFileSync } = process.getBuiltinModule('node:fs');
  const folder = ['test-private', 'docs/test-private']
    .map((path) => `${process.cwd()}/${path}`)
    .find((path) => existsSync(`${path}/skilled-3moa-308-shot.json`));
  if (!folder) console.info('No test-private folder here: skipping the test on the real photo.');

  it.skipIf(!folder)(
    'finds 5 of 5 on targets 1 and 2 and nothing on 3 and 4',
    { timeout: 60000 },
    async () => {
      const { cv } = await openCvReady(cvModule);
      const fixture = JSON.parse(
        readFileSync(`${folder}/skilled-3moa-308-shot.json`).toString(),
      ) as {
        calibre_mm: number;
        tolerancePx: number;
        targets: { n: number; shots: number; holes: [number, number][] }[];
      };
      const decoded = jpeg.decode(readFileSync(`${folder}/skilled-3moa-308-shot.jpg`), {
        useTArray: true,
      });
      const image = { ...decoded, data: new Uint8ClampedArray(decoded.data) };
      const result = detectTarget(cv, {
        kind: 'measure',
        image,
        template: SKILLED,
        manual: null,
        holeMm: fixture.calibre_mm,
        shots: 5,
      }) as MeasureResult;
      expect(result.plane?.scale.source).toBe('targets');
      for (const target of fixture.targets) {
        const found = result
          .targets!.find((t) => t.n === target.n)!
          .holes.filter((h) => !h.doubtful);
        expect(found).toHaveLength(target.holes.length);
        for (const [x, y] of target.holes) {
          const nearest = Math.min(...found.map((p) => Math.hypot(p.x - x, p.y - y)));
          expect(nearest).toBeLessThanOrEqual(fixture.tolerancePx);
        }
      }
    },
  );
});
