import { PhotoMarks, PhotoTarget, Point, Session } from '../ballistics/model';
import { toUnits } from '../ballistics/series';
import {
  applyHomography,
  homography,
  invertHomography,
  orderCorners,
  pxPerMmAt,
  rectangle,
  tiltDegrees,
} from './homography';
import {
  assignToTargets,
  caliberMm,
  defaultSeries,
  fitLayout,
  matchesLayout,
  measureTarget,
  offsetShort,
  photosWithTemplate,
  spread,
  templateText,
  toMillimetres,
  turnedTargets,
  turnPlane,
  turnPoint,
  withMeasurement,
} from './measure';
import { assessQuality, issueText, MEASURE_LIMITS, TEMPLATE_LIMITS } from './quality';
import { snapToLine } from './snap';
import { TEST_TARGETS } from './testing/templates';

const auto = ([x, y]: number[]) => ({ x, y, auto: true });
const manualScale = {
  source: 'manual' as const,
  p1: { x: 90, y: 300 },
  p2: { x: 150, y: 300 },
  mm: 25,
};
const MOCKUP: PhotoTarget = {
  n: 1,
  aim: { x: 180, y: 180 },
  holes: [
    ...[
      [160, 250],
      [262, 186],
      [214, 285],
      [205, 212],
    ].map(auto),
    { x: 209, y: 212, auto: false },
  ],
};
const marks = { scale: manualScale };

describe('measureTarget', () => {
  it('reproduces the mockup: 5 holes, 25 mm = 60 px', () => {
    const { group, offset } = measureTarget(marks, MOCKUP);
    expect(group).toBeCloseTo(50.17, 1);
    expect(offset?.offUp).toBeCloseTo(-20.4, 1);
    expect(offset?.offRight).toBeCloseTo(12.5, 1);
  });

  it('converts to angles at the series distance', () => {
    const { group, offset } = measureTarget(marks, MOCKUP);
    expect(((group as number) / 200) * 3.4377).toBeCloseTo(0.86, 2);
    expect(toUnits(Math.abs(offset?.offUp as number) / 200, 'MRAD')).toBeCloseTo(0.1, 2);
    expect(toUnits((offset?.offRight as number) / 200, 'MRAD')).toBeCloseTo(0.06, 2);
  });

  it('leaves the cold shot out of the group and reports it separately', () => {
    const result = measureTarget(marks, {
      ...MOCKUP,
      holes: [{ x: 300, y: 60, auto: true, cold: true }, ...MOCKUP.holes],
    });
    expect(result.group).toBeCloseTo(50.17, 1);
    expect(result.cold?.offUp).toBeCloseTo(50, 5);
    expect(result.cold?.offRight).toBeCloseTo(50, 5);
  });

  it('has no group from one hole and no offset without a point of aim', () => {
    expect(measureTarget(marks, { aim: null, holes: [MOCKUP.holes[0]] })).toEqual({
      group: null,
      offset: null,
      cold: null,
    });
  });

  it('finds the widest pair', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 1, y: 1 },
    ];
    expect(spread(points)).toBe(5);
  });
});

describe('sheet of four targets from mockup 15b', () => {
  const aims: Point[] = [
    { x: 55, y: 80 },
    { x: 155, y: 80 },
    { x: 55, y: 217 },
    { x: 155, y: 217 },
  ];
  const holes = [
    [63, 90],
    [67, 84],
    [59, 94],
    [69, 92],
    [64, 88],
    [152, 82],
    [157, 76],
    [155, 85],
    [160, 81],
    [153, 78],
    [40, 211],
    [50, 227],
    [45, 219],
    [57, 209],
    [47, 229],
  ].map(([x, y]) => ({ x, y }));
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const sheet: Pick<PhotoMarks, 'scale' | 'homography'> = {
    scale: { source: 'sheet', p1: { x: 0, y: 0 }, p2: { x: 210, y: 0 }, mm: 210 },
    homography: identity,
  };
  const assigned = assignToTargets(holes, aims);
  const result = (n: number) =>
    measureTarget(sheet, {
      aim: aims[n],
      holes: holes.filter((_, i) => assigned[i] === n).map((h) => ({ ...h, auto: true })),
    });

  it('sends each hole to its target and leaves the fourth empty', () => {
    expect(assigned).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  });

  it('target 1: 13 mm, ↓10 →9', () => {
    const { group, offset } = result(0);
    expect(Math.round(group as number)).toBe(13);
    expect(offsetShort(offset)).toBe('↓10 →9');
  });

  it('target 2: 9 mm, on the point of aim', () => {
    const { group, offset } = result(1);
    expect(Math.round(group as number)).toBe(9);
    expect(offsetShort(offset)).toBe('в точку');
  });

  it('target 3: 22 mm, ↓2 ←7', () => {
    const { group, offset } = result(2);
    expect(Math.round(group as number)).toBe(22);
    expect(offsetShort(offset)).toBe('↓2 ←7');
  });

  it('leaves a hole far from every target unassigned', () => {
    expect(assignToTargets([{ x: 500, y: 500 }], aims)).toEqual([-1]);
  });

  it('keeps any hole when there is a single target', () => {
    expect(assignToTargets([{ x: 500, y: 500 }], [aims[0]])).toEqual([0]);
  });
});

describe('perspective', () => {
  /** A camera `tilt` degrees off the normal of an A4 sheet, 500 mm away. */
  function camera(tilt: number, width = 3000, height = 4000) {
    const f = Math.max(width, height) * 0.7;
    const a = (tilt * Math.PI) / 180;
    const project = ({ x, y }: Point): Point => {
      const [px, py] = [x - 105, y - 148.5];
      const yc = py * Math.cos(a);
      const zc = 500 + py * Math.sin(a);
      return { x: (f * px) / zc + width / 2, y: (f * yc) / zc + height / 2 };
    };
    return { project, width, height };
  }

  it('recovers holes on A4 at 25° to within 0.5 mm', () => {
    const { project } = camera(25);
    const h = homography(rectangle(210, 297).map(project), rectangle(210, 297))!;
    const mm = toMillimetres({ scale: manualScale, homography: [...h] });
    for (const hole of [
      { x: 20, y: 30 },
      { x: 190, y: 270 },
      { x: 105, y: 148.5 },
    ]) {
      const back = mm(project(hole));
      expect(Math.hypot(back.x - hole.x, back.y - hole.y)).toBeLessThan(0.5);
    }
  });

  it('reads the tilt from the homography', () => {
    for (const tilt of [0, 18, 25, 41]) {
      const { project, width, height } = camera(tilt);
      const h = homography(rectangle(210, 297).map(project), rectangle(210, 297))!;
      expect(tiltDegrees(h, width, height)).toBeCloseTo(tilt, 0);
    }
  });

  it('inverts and gives pixels per mm', () => {
    const tilted: Point[] = [
      { x: 120, y: 80 },
      { x: 900, y: 150 },
      { x: 840, y: 780 },
      { x: 60, y: 900 },
    ];
    const h = homography(tilted, rectangle(100, 100))!;
    const corner = applyHomography(invertHomography(h), { x: 100, y: 100 });
    expect(corner.x).toBeCloseTo(840, 6);
    expect(corner.y).toBeCloseTo(780, 6);
    expect(pxPerMmAt(h, { x: 50, y: 50 })).toBeGreaterThan(5);
  });

  it('rejects collinear corners', () => {
    const line = [0, 1, 2, 3].map((i) => ({ x: i, y: i }));
    expect(homography(line, rectangle(1, 1))).toBeNull();
  });

  it('orders corners tapped in any order', () => {
    const [a, b, c, d] = [
      { x: 120, y: 80 },
      { x: 900, y: 150 },
      { x: 840, y: 780 },
      { x: 60, y: 900 },
    ];
    expect(orderCorners([c, a, d, b])).toEqual([a, b, c, d]);
  });
});

describe('quality checks', () => {
  const square = (size: number, angleError = 0.3) => ({ size, angleError });

  it('passes a flat sheet', () => {
    expect(assessQuality(18, 6, [square(30), square(30.3)], MEASURE_LIMITS).issues).toEqual([]);
  });

  it('flags a sheet bent by 5%', () => {
    expect(assessQuality(18, 6, [square(30), square(31.5)], MEASURE_LIMITS).issues).toEqual([
      'bent',
    ]);
  });

  it('flags corners that are no longer right angles', () => {
    expect(assessQuality(18, 6, [square(30, 3)], MEASURE_LIMITS).issues).toEqual(['bent']);
  });

  it('blames the print, not the sheet, for an element of the wrong size', () => {
    const element = { size: 26.5, expected: 25, angleError: 0 };
    const quality = assessQuality(0, 6, [element], MEASURE_LIMITS);
    expect(quality.issues).toEqual(['print-scale']);
    expect(quality.printScale).toBeCloseTo(1.06, 2);
    expect(issueText('print-scale', quality.printScale)).toContain('≈ 106 %');
  });

  it('says the elements were not found instead of calling the sheet bent', () => {
    const issues = assessQuality(0, 6, [square(30), square(40)], MEASURE_LIMITS, { missing: true });
    expect(issues.issues).toEqual(['elements']);
  });

  it('flags a steep angle and too few pixels', () => {
    expect(assessQuality(45, 2, [], MEASURE_LIMITS).issues).toEqual(['tilt', 'resolution']);
  });

  it('is stricter for a template', () => {
    const elements = [square(30), square(30.75)];
    expect(assessQuality(35, 3.5, elements, MEASURE_LIMITS).issues).toEqual([]);
    expect(assessQuality(35, 3.5, elements, TEMPLATE_LIMITS).issues).toEqual([
      'tilt',
      'bent',
      'resolution',
    ]);
  });
});

describe('series for targets', () => {
  const option = (si: number, filled = false) => ({ si, number: si + 1, label: '', filled });

  it('goes in order from the current series', () => {
    expect(
      defaultSeries(
        3,
        [0, 1, 2, 3, 4].map((i) => option(i)),
        2,
      ),
    ).toEqual([2, 3, 4]);
  });

  it('prefers empty series', () => {
    const options = [option(0), option(1, true), option(2), option(3)];
    expect(defaultSeries(3, options, 0)).toEqual([0, 2, 3]);
  });

  it('starts at the first empty one without a current series', () => {
    expect(defaultSeries(2, [option(0, true), option(1), option(2)])).toEqual([1, 2]);
  });

  it('runs out', () => {
    expect(defaultSeries(2, [option(0)], 0)).toEqual([0, null]);
  });
});

describe('withMeasurement', () => {
  const scale = { ...manualScale, source: 'sheet' as const };
  const session = {
    id: 's',
    createdAt: '',
    updatedAt: '',
    rifleId: 'r',
    date: '2026-11-09',
    series: [
      { kind: 'normal', scopeId: 'c', ammoId: 'a' },
      { kind: 'normal', scopeId: 'c', ammoId: 'a', group: 9 },
    ],
    photos: [{ id: 'p' }],
  } as Session;

  it('writes every target into its series and keeps the marks on the photo', () => {
    const photo = { id: 'p', marks: { scale, targets: [{ n: 1, si: 0, holes: [] }] } };
    const result = withMeasurement(session, photo, [
      { si: 0, group: 13, offset: { offUp: -10, offRight: 9 } },
      { si: 1, group: null, offset: null },
    ]);
    expect(result.series[0]).toMatchObject({ group: 13, offUp: -10, offRight: 9 });
    expect(result.series[1].group).toBe(9);
    expect(result.photos).toEqual([photo]);
  });

  it('adds a photo the session does not have yet', () => {
    expect(withMeasurement(session, { id: 'new' }, []).photos?.map((p) => p.id)).toEqual([
      'p',
      'new',
    ]);
  });
});

describe('turnPlane', () => {
  const photo = { w: 1600, h: 1200 };
  const sheet = { w: 297, h: 210 };
  const corners = [
    { x: 120, y: 90 },
    { x: 1500, y: 140 },
    { x: 1450, y: 1100 },
    { x: 160, y: 1050 },
  ];
  const flat: PhotoMarks['scale'] = {
    source: 'sheet',
    p1: corners[0],
    p2: corners[1],
    mm: sheet.w,
    sheet,
  };
  const plane = {
    scale: flat,
    homography: [...homography(corners, rectangle(sheet.w, sheet.h))!],
  };
  const inPhoto = (p: Point, size = photo) => turnPoint(size, 1, p);
  const sideways = { w: photo.h, h: photo.w };

  it('swaps the sides of the sheet and keeps the scale points the same distance apart', () => {
    const { scale } = turnPlane(plane, photo);
    expect(scale.sheet).toEqual({ w: 210, h: 297 });
    expect(scale.p1).toEqual(inPhoto(corners[0]));
    expect(scale.mm).toBe(sheet.w);
  });

  it('sends a turned pixel to the same spot of the turned sheet', () => {
    const turned = turnPlane(plane, photo).homography!;
    const p = { x: 700, y: 400 };
    const expected = turnPoint(sheet, 1, applyHomography(plane.homography, p));
    const seen = applyHomography(turned, inPhoto(p));
    expect(seen.x).toBeCloseTo(expected.x, 6);
    expect(seen.y).toBeCloseTo(expected.y, 6);
  });

  it('keeps the group and turns the offset clockwise with the picture', () => {
    const target = {
      aim: { x: 700, y: 500 },
      holes: [
        { x: 900, y: 500 },
        { x: 900, y: 560 },
      ],
    };
    const before = measureTarget(plane, target);
    const after = measureTarget(turnPlane(plane, photo), {
      aim: inPhoto(target.aim),
      holes: target.holes.map((hole) => inPhoto(hole)),
    });
    expect(after.group).toBeCloseTo(before.group!, 6);
    // What was to the right of the point of aim is now below it.
    expect(after.offset!.offUp).toBeCloseTo(-before.offset!.offRight, 6);
    expect(after.offset!.offRight).toBeCloseTo(before.offset!.offUp, 6);
  });

  it('comes back after four turns', () => {
    const around = [photo, sideways, photo, sideways].reduce(
      (current, size) => turnPlane(current, size),
      plane as ReturnType<typeof turnPlane>,
    );
    expect(around.scale.p1.x).toBeCloseTo(corners[0].x, 6);
    expect(around.scale.p1.y).toBeCloseTo(corners[0].y, 6);
    expect(around.scale.sheet).toEqual(sheet);
    around.homography!.forEach((value, i) => {
      expect(value / around.homography![8]).toBeCloseTo(
        plane.homography[i] / plane.homography[8],
        6,
      );
    });
  });

  it('makes three turns at once the same as one by one', () => {
    const stepped = [photo, sideways, photo].reduce(
      (current, size) => turnPlane(current, size),
      plane as ReturnType<typeof turnPlane>,
    );
    const direct = turnPlane(plane, photo, 3);
    expect(direct.scale.p1.x).toBeCloseTo(stepped.scale.p1.x, 6);
    expect(direct.scale.p1.y).toBeCloseTo(stepped.scale.p1.y, 6);
    expect(direct.scale.sheet).toEqual(stepped.scale.sheet);
    direct.homography!.forEach((value, i) => {
      expect(value / direct.homography![8]).toBeCloseTo(
        stepped.homography![i] / stepped.homography![8],
        6,
      );
    });
  });

  it('keeps a manual scale without a homography', () => {
    const turned = turnPlane({ scale: manualScale }, photo);
    expect(turned.homography).toBeUndefined();
    expect(turned.scale.sheet).toBeUndefined();
    expect(turned.scale.p1).toEqual(inPhoto(manualScale.p1));
    expect(turned.scale.p2).toEqual(inPhoto(manualScale.p2));
    expect(turned.scale.mm).toBe(manualScale.mm);
  });
});

describe('templates', () => {
  const four = TEST_TARGETS[2];

  it('describes one', () => {
    expect(templateText(four)).toBe('A4 · 4 мишени · квадрат 30 мм');
  });

  it('turns with the sheet', () => {
    const { sheet, targets } = turnedTargets(four, 1);
    expect(sheet).toEqual({ w: 297, h: 210 });
    expect(targets[0]).toMatchObject({ x: 217, y: 55 });
  });

  it('turns the aim offset the same way as the sheet', () => {
    const template = {
      sheet: { w: 100, h: 200 },
      targets: [
        {
          n: 1,
          x: 50,
          y: 50,
          reference: { kind: 'square', size: 10 } as const,
          aim: { up: 5, right: 0 },
        },
      ],
    };
    // Up on the sheet (−y) becomes right after a quarter turn clockwise.
    expect(turnedTargets(template, 1).targets[0].aim).toEqual({ up: -0, right: 5 });
    expect(turnedTargets(template, 2).targets[0].aim).toEqual({ up: -5, right: -0 });
    expect(turnedTargets(template, 3).targets[0].aim).toEqual({ up: 0, right: -5 });
  });

  it('recognises its layout in found elements', () => {
    const elements = four.targets.map((t) => ({
      x: t.x + 2,
      y: t.y - 3,
      kind: 'square' as const,
      size: 30,
    }));
    expect(matchesLayout(four, elements)).toBe(true);
    expect(matchesLayout(four, elements.slice(1))).toBe(false);
    expect(matchesLayout(TEST_TARGETS[0], elements)).toBe(false);
  });
});

describe('photosWithTemplate', () => {
  it('counts marked photos across sessions, and only those of this template', () => {
    const marks = (templateId?: string) => ({
      id: 'p',
      marks: { templateId, scale: manualScale, targets: [] },
    });
    const sessions = [
      { photos: [marks('a'), marks('b'), { id: 'bare' }] },
      { photos: [marks('a')] },
      {},
    ] as unknown as Session[];
    expect(photosWithTemplate(sessions, 'a')).toBe(2);
    expect(photosWithTemplate(sessions, 'c')).toBe(0);
  });
});

describe('fitLayout', () => {
  const layout = TEST_TARGETS.find((t) => t.id === 'std-skilled-3moa-100')!;
  const sized = (x: number, y: number) => ({ x, y });

  it('places a drawing printed lower on the sheet', () => {
    const found = layout.targets.map((t) => sized(t.x, t.y + 43.5));
    const [fit] = fitLayout(found, layout, [0], () => true, 18);
    expect(fit.found).toBe(4);
    expect(fit.shift.x).toBeCloseTo(0, 5);
    expect(fit.shift.y).toBeCloseTo(43.5, 5);
  });

  it('places the targets it could not find next to those it could', () => {
    const found = layout.targets.slice(1).map((t) => sized(t.x + 7, t.y + 30));
    const [fit] = fitLayout(found, layout, [0], () => true, 18);
    expect(fit.found).toBe(3);
    expect(fit.matched[0]).toBeNull();
    expect(fit.shift.x).toBeCloseTo(7, 5);
  });

  it('matches a drawing anywhere on the sheet, but only with the right layout', () => {
    const found = layout.targets.map((t) => ({
      x: t.x + 20,
      y: t.y + 43.5,
      kind: 'rings' as const,
      size: 87.4,
    }));
    expect(matchesLayout(layout, found)).toBe(true);
    expect(matchesLayout(layout, found.slice(1))).toBe(false);
  });

  it('keeps the numbers of a sheet turned a quarter clockwise', () => {
    const { targets } = turnedTargets(layout, 1);
    expect(targets[0].x).toBeGreaterThan(targets[2].x);
    expect(targets[0].y).toBeLessThan(targets[1].y);
  });
});

describe('snapToLine', () => {
  /** A horizontal ruler: a dark tick across it every 10 px. */
  function ruler(width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = x % 10 === 0 ? 40 : 220;
        data.fill(v, (y * width + x) * 4, (y * width + x) * 4 + 4);
      }
    }
    return { data, width, height };
  }

  it('pulls a tap onto the nearest mark along the ruler', () => {
    expect(snapToLine(ruler(100, 100), { x: 42, y: 50 }, 4)).toEqual({ x: 40, y: 50 });
  });

  it('leaves a tap alone on blank paper', () => {
    const blank = { data: new Uint8ClampedArray(4 * 2500).fill(220), width: 50, height: 50 };
    expect(snapToLine(blank, { x: 25, y: 25 }, 6)).toEqual({ x: 25, y: 25 });
  });
});

describe('caliberMm', () => {
  it.each([
    ['.308', 7.82],
    ['308 Win', 7.82],
    ['.223 Rem', 5.66],
    ['6,5×47', 6.5],
    ['6.5 Creedmoor', 6.5],
    ['9 мм', 9],
    ['', 7.82],
    [undefined, 7.82],
  ])('%s', (text, expected) => {
    expect(caliberMm(text)).toBeCloseTo(expected, 1);
  });
});
