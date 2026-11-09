import { Point, TemplateTarget } from '../ballistics/model';
import {
  DetectImage,
  detectTarget,
  MeasureRequest,
  MeasureResult,
  openCvReady,
  SurveyResult,
  WarpResult,
} from './detect';
import { Homography, homography, applyHomography, rectangle } from './homography';
import { measureTarget } from './measure';
import { TEST_TARGETS } from './testing/templates';

type Cv = Parameters<typeof detectTarget>[0];

interface NodeProcess {
  cwd(): string;
  getBuiltinModule(name: 'node:module'): {
    createRequire(path: string): (id: string) => unknown;
  };
}

/**
 * Required, not imported: the module exports `then`, so anything that awaits its namespace
 * (as the test runner does) never finishes. The spec project has no Node typings.
 */
const { process } = globalThis as unknown as { process: NodeProcess };
const cvModule = process
  .getBuiltinModule('node:module')
  .createRequire(`${process.cwd()}/package.json`)('@techstark/opencv-js');

/** What a sheet looks like at a point, in mm. */
type Sheet = (mm: Point) => number;

const A4 = { w: 210, h: 297 };
const HOLE = 3.9;
const PAPER = 225;
const SQUARE = 25;
const CENTRES: Point[] = TEST_TARGETS[2].targets;
const inSquare = ({ x, y }: Point, c: Point, size: number) =>
  Math.abs(x - c.x) < size / 2 && Math.abs(y - c.y) < size / 2;

/** A hole shows dark through the paper and light through a black field. */
function paper(holes: readonly Point[], draw: (p: Point) => number | null): Sheet {
  return (mm) => {
    const printed = draw(mm);
    if (holes.some((h) => Math.hypot(mm.x - h.x, mm.y - h.y) < HOLE)) {
      return printed != null && printed < 100 ? 200 : 40;
    }
    return printed ?? PAPER;
  };
}

const fourSquares = (holes: readonly Point[], sizes = [30, 30, 30, 30]) =>
  paper(holes, (p) => (CENTRES.some((c, i) => inSquare(p, c, sizes[i])) ? 25 : null));

function gridWithSquare(holes: readonly Point[]): Sheet {
  const line = (v: number, c: number) => Math.abs(((v - c + 12.5) % 25) - 12.5) < 0.2;
  return paper(holes, (p) => {
    if (inSquare(p, { x: 105, y: 148.5 }, SQUARE)) return 25;
    return line(p.x, 105) || line(p.y, 148.5) ? 170 : null;
  });
}

/** Draws a sheet; `toSheet` says which point of it each pixel sees. */
function photograph(
  sheet: Sheet,
  size: { w: number; h: number },
  width: number,
  height: number,
  toSheet: Homography,
  background = 80,
): DetectImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const mm = applyHomography(toSheet, { x: px, y: py });
      const inside = mm.x >= 0 && mm.y >= 0 && mm.x <= size.w && mm.y <= size.h;
      // Light falls off to the right, as it does on a real shot.
      const value = inside ? sheet(mm) * (1 - (0.2 * px) / width) : background;
      const i = (py * width + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const SKILLED = TEST_TARGETS.find((t) => t.id === 'std-skilled-3moa-100')!;
const BROWN = 95;

/** The Skilled Shooting drawing: `at` is in mm from its top left corner. */
function skilledArt(at: Point): number | null {
  for (const c of SKILLED.targets) {
    const [dx, dy] = [at.x - c.x, at.y - c.y];
    const r = Math.hypot(dx, dy);
    if (r >= 43.7) continue;
    if (r < 14.5) return Math.abs(dx) < 0.25 || Math.abs(dy) < 0.25 ? 90 : 240;
    if (r > 25.9 && r < 29.4) return 240;
    const cross = Math.abs(dx) < 0.35 || Math.abs(dy) < 0.35;
    const grid = Math.abs(Math.abs(dx) - 28) < 0.3 || Math.abs(Math.abs(dy) - 28) < 0.3;
    return cross || grid ? 240 : BROWN;
  }
  return null;
}

/** The drawing printed in the middle of A4, turned a quarter clockwise, at a given scale. */
function skilledSheet(holes: readonly Point[], print = 1): Sheet {
  const toArt = ({ x, y }: Point): Point => {
    const [sx, sy] = [(x - 105) / print + 105, (y - 148.5) / print + 148.5 - 43.5];
    return { x: sy, y: 210 - sx };
  };
  return (mm) => {
    const art = skilledArt(toArt(mm));
    if (holes.some((h) => Math.hypot(mm.x - h.x, mm.y - h.y) < HOLE)) {
      return art != null && art < 150 ? 215 : 45;
    }
    return art ?? PAPER;
  };
}

/** A point of the drawing on the sheet of `skilledSheet`. */
const artOnSheet = ({ x, y }: Point, print = 1): Point => ({
  x: (210 - y - 105) * print + 105,
  y: (x + 43.5 - 148.5) * print + 148.5,
});

const WIDTH = 1300;
const HEIGHT = 1700;
const STRAIGHT: Point[] = [
  { x: 130, y: 110 },
  { x: 1170, y: 110 },
  { x: 1170, y: 1580 },
  { x: 130, y: 1580 },
];
const TILTED: Point[] = [
  { x: 240, y: 170 },
  { x: 1090, y: 120 },
  { x: 1240, y: 1610 },
  { x: 70, y: 1560 },
];

const view = (corners: Point[], size = A4) => homography(corners, rectangle(size.w, size.h))!;

/** Far enough apart not to merge: inside, on the edge of and outside the black squares. */
const SPREAD_HOLES: Point[][] = [
  [
    [50, 75],
    [62, 88],
    [85, 95],
    [25, 70],
    [70, 110],
  ],
  [
    [150, 70],
    [163, 90],
    [125, 95],
    [185, 65],
    [140, 115],
  ],
  [
    [48, 210],
    [40, 222],
    [85, 200],
    [25, 225],
    [70, 250],
  ],
].map((target) => target.map(([x, y]) => ({ x, y })));
const ALL_HOLES = SPREAD_HOLES.flat();

const widest = (points: readonly Point[]) =>
  Math.max(...points.flatMap((a) => points.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));

describe('detectTarget', () => {
  let cv: Cv;

  beforeAll(async () => {
    ({ cv } = await openCvReady(cvModule));
  }, 60000);

  const measure = (image: DetectImage, extra: Partial<MeasureRequest> = {}) =>
    detectTarget(cv, {
      kind: 'measure',
      image,
      template: TEST_TARGETS[2],
      manual: null,
      holeMm: HOLE * 2,
      shots: 5,
      ...extra,
    }) as MeasureResult;

  function group(result: MeasureResult, n: number) {
    return measureTarget(
      result.plane!,
      result.targets!.find((t) => t.n === n)!,
    );
  }

  it('finds the sheet on a tilted shot and measures each of the four targets', () => {
    const image = photograph(fourSquares(ALL_HOLES), A4, WIDTH, HEIGHT, view(TILTED));
    const result = measure(image);
    expect(result.plane?.scale.source).toBe('sheet');
    expect(result.flat?.width).toBe((210 + 12) * 5);
    expect(result.targets?.map((t) => t.holes.length)).toEqual([5, 5, 5, 0]);
    expect(result.elements).toHaveLength(4);
    const first = group(result, 1);
    expect(Math.abs((first.group as number) - widest(SPREAD_HOLES[0]))).toBeLessThan(0.7);
    const third = group(result, 3);
    expect(Math.abs((third.group as number) - widest(SPREAD_HOLES[2]))).toBeLessThan(0.7);
    expect(result.quality?.issues).toEqual([]);
  });

  it('restores hole positions to within 0.5 mm', () => {
    const image = photograph(fourSquares(ALL_HOLES), A4, WIDTH, HEIGHT, view(TILTED));
    const result = measure(image);
    const h = result.plane!.homography!;
    const found = result.targets!.flatMap((t) => t.holes.map((p) => applyHomography(h, p)));
    for (const hole of ALL_HOLES) {
      const nearest = Math.min(...found.map((p) => Math.hypot(p.x - hole.x, p.y - hole.y)));
      expect(nearest).toBeLessThan(0.5);
    }
  });

  it('notices a bent sheet', () => {
    const image = photograph(
      fourSquares(ALL_HOLES, [30, 30, 30, 31.5]),
      A4,
      WIDTH,
      HEIGHT,
      view(STRAIGHT),
    );
    expect(measure(image).quality?.issues).toContain('bent');
  });

  it('takes a sheet lying the other way round', () => {
    const size = { w: 297, h: 210 };
    const corners: Point[] = [
      { x: 100, y: 200 },
      { x: 1600, y: 200 },
      { x: 1600, y: 1260 },
      { x: 100, y: 1260 },
    ];
    // The portrait sheet turned a quarter turn clockwise.
    const turned: Sheet = ({ x, y }) => fourSquares([{ x: 90, y: 90 }])({ x: y, y: 210 - x });
    const result = measure(photograph(turned, size, 1700, 1460, view(corners, size)));
    expect(result.plane?.scale.sheet).toEqual(size);
    expect(result.targets).toHaveLength(4);
    expect(result.targets?.flatMap((t) => t.holes)).toHaveLength(1);
  });

  it('falls back to the printed square when the corners are out of the frame', () => {
    const frame: Point[] = [
      { x: -300, y: -400 },
      { x: 1600, y: -400 },
      { x: 1600, y: 2300 },
      { x: -300, y: 2300 },
    ];
    const holes = [
      [80, 120],
      [102, 148],
      [125, 165],
      [65, 150],
      [110, 180],
    ].map(([x, y]) => ({ x, y }));
    const image = photograph(gridWithSquare(holes), A4, WIDTH, HEIGHT, view(frame));
    const result = measure(image, { template: TEST_TARGETS[0] });
    expect(result.plane?.scale.source).toBe('element');
    expect(result.targets?.[0].holes).toHaveLength(5);
    expect(result.targets?.[0].aim).not.toBeNull();
  });

  it('keeps the reference intact when a hole hits its corner', () => {
    const frame: Point[] = [
      { x: -300, y: -400 },
      { x: 1600, y: -400 },
      { x: 1600, y: 2300 },
      { x: -300, y: 2300 },
    ];
    const corner = [{ x: 92.5, y: 136 }];
    const image = photograph(gridWithSquare(corner), A4, WIDTH, HEIGHT, view(frame));
    const result = measure(image, { template: TEST_TARGETS[0], shots: 1 });
    const aim = applyHomography(result.plane!.homography!, result.targets![0].aim!);
    expect(Math.hypot(aim.x - 105, aim.y - 148.5)).toBeLessThan(0.5);
    expect(result.quality?.issues).not.toContain('bent');
  });

  it('uses four printed squares when the sheet does not stand out', () => {
    const image = photograph(fourSquares(ALL_HOLES), A4, WIDTH, HEIGHT, view(STRAIGHT), 235);
    const result = measure(image);
    expect(result.plane?.scale.source).toBe('element');
    expect(result.targets?.map((t) => t.holes.length)).toEqual([5, 5, 5, 0]);
  });

  it('finds a bank card and rectifies by it', () => {
    const card = { w: 400, h: 400 };
    const frame = view(
      [
        { x: -200, y: -200 },
        { x: 1500, y: -200 },
        { x: 1500, y: 1500 },
        { x: -200, y: 1500 },
      ],
      card,
    );
    const holes = [
      { x: 250, y: 250 },
      { x: 270, y: 280 },
    ];
    const sheet = paper(holes, (p) =>
      p.x > 60 && p.x < 145.6 && p.y > 60 && p.y < 114 ? 45 : null,
    );
    const result = measure(photograph(sheet, card, 1300, 1300, frame), {
      template: null,
      shots: 2,
    });
    expect(result.plane?.scale.source).toBe('card');
    expect(result.plane?.homography).toBeDefined();
    expect(result.targets?.[0].holes).toHaveLength(2);
    expect(measureTarget(result.plane!, result.targets![0]).group).toBeCloseTo(36.06, 0);
  });

  it('finds rings on a sheet and takes the point of aim from them', () => {
    const diameters = [40, 80, 130, 180];
    const sheet: Sheet = ({ x, y }) => {
      const r = Math.hypot(x - 105, y - 148.5);
      return diameters.some((d) => Math.abs(r - d / 2) < 0.6) ? 30 : PAPER;
    };
    const result = measure(photograph(sheet, A4, WIDTH, HEIGHT, view(STRAIGHT)), {
      template: TEST_TARGETS[1],
    });
    const aim = applyHomography(result.plane!.homography!, result.targets![0].aim!);
    expect(aim.x).toBeCloseTo(105, 0);
    expect(aim.y).toBeCloseTo(148.5, 0);
  });

  describe('rings printed light on dark', () => {
    const measureSkilled = (image: DetectImage, shots = 3) =>
      measure(image, { template: SKILLED, shots });
    const image = (holes: Point[] = [], print = 1) =>
      photograph(skilledSheet(holes, print), A4, WIDTH, HEIGHT, view(TILTED));
    const aimOf = (result: MeasureResult, n: number) =>
      applyHomography(result.plane!.homography!, result.targets!.find((t) => t.n === n)!.aim!);

    it('finds all four centres on a turned and tilted sheet', () => {
      const result = measureSkilled(image());
      expect(result.elements.filter((e) => e.kind === 'rings')).toHaveLength(4);
      const aims = SKILLED.targets.map((target) => aimOf(result, target.n));
      for (const target of SKILLED.targets) {
        const expected = artOnSheet(target);
        const nearest = Math.min(
          ...aims.map((a) => Math.hypot(a.x - expected.x, a.y - expected.y)),
        );
        expect(nearest).toBeLessThan(1);
      }
      expect(result.quality?.issues).toEqual([]);
    });

    it('warns about a print at 95% and takes the size from the rings', () => {
      const result = measureSkilled(image([], 0.95));
      expect(result.quality?.issues).toContain('print-scale');
      expect(result.quality?.issues).not.toContain('bent');
      expect(result.quality?.printScale).toBeCloseTo(0.95, 1);
      expect(result.plane?.scale.source).toBe('element');
      const [a, b] = [aimOf(result, 1), aimOf(result, 2)];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(93.1, 0);
    });

    it('finds holes in the white centre, on the dark field and on the white ring', () => {
      const [centre, field, ring] = [
        artOnSheet({ x: 54, y: 62 }),
        artOnSheet({ x: 58.4 + 16, y: 58.5 + 12 }),
        artOnSheet({ x: 58.4, y: 58.5 - 27.6 }),
      ];
      const result = measureSkilled(image([centre, field, ring]));
      // The rings are symmetric, so nothing tells which of the four is number 1.
      const hit = result.targets!.filter((t) => t.holes.length);
      expect(hit).toHaveLength(1);
      const found = hit[0].holes.map((p) => applyHomography(result.plane!.homography!, p));
      expect(found).toHaveLength(3);
      for (const hole of [centre, field, ring]) {
        const nearest = Math.min(...found.map((p) => Math.hypot(p.x - hole.x, p.y - hole.y)));
        expect(nearest).toBeLessThan(1);
      }
    });

    it('says the elements are missing instead of calling the sheet bent', () => {
      const blank = photograph(
        paper([], () => null),
        A4,
        WIDTH,
        HEIGHT,
        view(TILTED),
      );
      expect(measureSkilled(blank).quality?.issues).toEqual(['elements']);
    });

    it('proposes the rings from a blank sheet, light and dark', () => {
      const survey = detectTarget(cv, {
        kind: 'survey',
        image: image(),
        sheet: A4,
      }) as SurveyResult;
      expect(survey.targets).toHaveLength(4);
      const reference = survey.targets![0].reference as { rings?: { edge: string }[] };
      expect(reference.rings?.map((r) => r.edge)).toEqual([
        'light-disc',
        'light-ring',
        'dark-disc',
      ]);
    });
  });

  it('finds a light circle on a dark field', () => {
    const field = (p: Point) => Math.abs(p.x - 105) < 60 && Math.abs(p.y - 148.5) < 60;
    const sheet = paper([], (p) => {
      if (Math.hypot(p.x - 105, p.y - 148.5) < 15) return 235;
      return field(p) ? 40 : null;
    });
    const template = {
      sheet: A4,
      targets: [
        {
          n: 1,
          x: 105,
          y: 148.5,
          reference: { kind: 'circle' as const, size: 30, polarity: 'light' as const },
          aim: { up: 0, right: 0 },
        },
      ],
    };
    const result = measure(photograph(sheet, A4, WIDTH, HEIGHT, view(STRAIGHT)), {
      template,
      shots: 1,
    });
    const aim = applyHomography(result.plane!.homography!, result.targets![0].aim!);
    expect(Math.hypot(aim.x - 105, aim.y - 148.5)).toBeLessThan(1);
    expect(result.quality?.issues).toEqual([]);
  });

  it('flags the extras when there are more holes than shots', () => {
    const image = photograph(fourSquares(SPREAD_HOLES[0]), A4, WIDTH, HEIGHT, view(STRAIGHT));
    const holes = measure(image, { shots: 3 }).targets![0].holes;
    expect(holes).toHaveLength(5);
    expect(holes.filter((h) => h.doubtful)).toHaveLength(2);
  });

  it('counts two merged holes as two', () => {
    const merged = [
      { x: 40, y: 40 },
      { x: 46.5, y: 40 },
    ];
    const image = photograph(fourSquares(merged), A4, WIDTH, HEIGHT, view(STRAIGHT));
    expect(measure(image, { shots: 2 }).targets![0].holes).toHaveLength(2);
  });

  it('finds a hole inside a black square', () => {
    const sheet: Sheet = (mm) =>
      Math.hypot(mm.x - 58, mm.y - 76) < HOLE ? 200 : fourSquares([])(mm);
    const image = photograph(sheet, A4, WIDTH, HEIGHT, view(STRAIGHT));
    expect(measure(image, { shots: 1 }).targets![0].holes).toHaveLength(1);
  });

  it('gives up without a sheet, a card or an element, and uses a scale set by hand', () => {
    const frame = view([
      { x: -500, y: -500 },
      { x: 2000, y: -500 },
      { x: 2000, y: 2400 },
      { x: -500, y: 2400 },
    ]);
    const blank = photograph(
      paper(SPREAD_HOLES[0].slice(0, 3), () => null),
      A4,
      WIDTH,
      HEIGHT,
      frame,
    );
    expect(measure({ ...blank, data: blank.data.slice() }).targets).toBeNull();
    const pxPerMm = 2500 / 210;
    const manual = {
      scale: {
        source: 'manual' as const,
        p1: { x: 0, y: 0 },
        p2: { x: 25 * pxPerMm, y: 0 },
        mm: 25,
      },
    };
    const byHand = measure(blank, { template: null, manual, shots: 3 });
    expect(byHand.targets?.[0].holes).toHaveLength(3);
  });

  describe('survey of a blank sheet', () => {
    const survey = (image: DetectImage, sheet = A4) =>
      detectTarget(cv, { kind: 'survey', image, sheet }) as SurveyResult;
    const targetsOf = (result: SurveyResult) => result.targets as TemplateTarget[];

    it('proposes the targets, their layout and size', () => {
      const result = survey(photograph(fourSquares([]), A4, WIDTH, HEIGHT, view(TILTED)));
      const targets = targetsOf(result);
      expect(result.sheet).toEqual(A4);
      expect(targets).toHaveLength(4);
      expect(targets[0].reference).toEqual({ kind: 'square', size: 30 });
      expect(targets.map((t) => Math.abs(t.x - CENTRES[t.n - 1].x))).toEqual(
        expect.arrayContaining([expect.any(Number)]),
      );
      for (const t of targets) {
        expect(Math.abs(t.x - CENTRES[t.n - 1].x)).toBeLessThan(1);
        expect(Math.abs(t.y - CENTRES[t.n - 1].y)).toBeLessThan(1);
      }
      expect(result.quality?.issues).toEqual([]);
    });

    it('is stricter about elements that differ', () => {
      const image = photograph(
        fourSquares([], [30, 30, 30, 30.9]),
        A4,
        WIDTH,
        HEIGHT,
        view(STRAIGHT),
      );
      expect(survey(image).quality?.issues).toContain('bent');
    });

    it('refuses a photo with no corners and no card', () => {
      const frame = view([
        { x: -500, y: -500 },
        { x: 2000, y: -500 },
        { x: 2000, y: 2400 },
        { x: -500, y: 2400 },
      ]);
      const image = photograph(fourSquares([]), A4, WIDTH, HEIGHT, frame);
      expect(survey(image).plane).toBeNull();
    });

    it('finds rings and a grid', () => {
      const diameters = [60, 120, 180];
      const rings: Sheet = ({ x, y }) => {
        const r = Math.hypot(x - 105, y - 148.5);
        return diameters.some((d) => Math.abs(r - d / 2) < 0.6) ? 30 : PAPER;
      };
      const ringTargets = targetsOf(survey(photograph(rings, A4, WIDTH, HEIGHT, view(STRAIGHT))));
      expect(ringTargets).toHaveLength(1);
      expect(ringTargets[0].reference.kind).toBe('rings');
      const found = (ringTargets[0].reference as { diameters: number[] }).diameters;
      expect(found.length).toBeGreaterThanOrEqual(3);
      expect(Math.abs(Math.max(...found) - 180)).toBeLessThan(2);

      const line = (v: number) => Math.abs(((v + 12.5) % 25) - 12.5) < 0.4;
      const grid: Sheet = ({ x, y }) => (line(x) || line(y) ? 60 : PAPER);
      const gridTargets = targetsOf(survey(photograph(grid, A4, WIDTH, HEIGHT, view(STRAIGHT))));
      expect(gridTargets[0].reference).toEqual({ kind: 'grid', step: 25 });
    });
  });

  it('rectifies a photo for a saved homography', () => {
    const matrix = view(STRAIGHT);
    const image = photograph(fourSquares([]), A4, WIDTH, HEIGHT, matrix);
    const result = detectTarget(cv, { kind: 'warp', image, homography: [...matrix], sheet: A4 });
    expect((result as WarpResult).flat.height).toBe((297 + 12) * 5);
  });
});
