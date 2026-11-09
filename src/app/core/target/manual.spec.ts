import { Point } from '../ballistics/model';
import { homography, rectangle } from './homography';
import {
  canMeasure,
  frameCorners,
  ManualMarks,
  manualLayout,
  segmentReading,
  sheetCheck,
  sheetCorners,
  sheetPlane,
  turnManual,
} from './manual';

const A4 = { w: 210, h: 297 };

const marks = (change: Partial<ManualMarks> = {}): ManualMarks => ({
  corners: null,
  segment: [],
  mm: null,
  centres: [],
  aim: null,
  edge: null,
  element: 'circle',
  sized: false,
  ...change,
});

/** A plane of 5 px per mm with no perspective at all. */
const CORNERS = rectangle(210, 297).map(({ x, y }) => ({ x: x * 5, y: y * 5 }));
const matrix = [...(homography(CORNERS, rectangle(210, 297)) as readonly number[])];

describe('segmentReading', () => {
  it('gives pixels per millimetre and the error of one pixel at each end', () => {
    const reading = segmentReading(
      [
        { x: 0, y: 0 },
        { x: 490, y: 0 },
      ],
      100,
    );
    expect(reading?.pxPerMm).toBeCloseTo(4.9);
    expect(reading?.errorMm).toBeCloseTo(0.29, 2);
  });

  it('needs both ends and a length', () => {
    expect(segmentReading([{ x: 0, y: 0 }], 100)).toBeNull();
    expect(
      segmentReading(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        null,
      ),
    ).toBeNull();
  });
});

describe('sheet corners', () => {
  it('start inside the edges of the shot', () => {
    expect(frameCorners({ w: 100, h: 200 })[2]).toEqual({ x: 92, y: 184 });
  });

  it('come back from the plane to where they are on the shot', () => {
    sheetCorners(matrix, A4).forEach((corner, i) => {
      expect(corner.x).toBeCloseTo(CORNERS[i].x);
      expect(corner.y).toBeCloseTo(CORNERS[i].y);
    });
  });

  it('lay the longer side of the sheet along the longer side on the shot', () => {
    const lying = rectangle(297, 210).map(({ x, y }) => ({ x: x * 5, y: y * 5 }));
    expect(sheetPlane(lying, A4)?.sheet).toEqual({ w: 297, h: 210 });
    expect(sheetPlane(CORNERS, A4)?.sheet).toEqual(A4);
  });
});

describe('sheetCheck', () => {
  const segment = (px: number): Point[] => [
    { x: 100, y: 100 },
    { x: 100 + px, y: 100 },
  ];

  it('agrees when the segment fits the sheet', () => {
    const check = sheetCheck(marks({ segment: segment(500), mm: 100 }), matrix, A4);
    expect(check?.width).toBeCloseTo(210);
    expect(check?.off).toBe(false);
  });

  it('warns when the two differ by more than 2 %', () => {
    const check = sheetCheck(marks({ segment: segment(500), mm: 95 }), matrix, A4);
    expect(check?.width).toBeCloseTo(199.5);
    expect(check?.off).toBe(true);
  });

  it('has nothing to compare without corners', () => {
    expect(sheetCheck(marks({ segment: segment(500), mm: 100 }), null, A4)).toBeNull();
  });
});

describe('manualLayout', () => {
  const at = (mmX: number, mmY: number): Point => ({ x: mmX * 5, y: mmY * 5 });

  it('reads the places on the sheet, in the order they were marked', () => {
    const layout = manualLayout(marks({ centres: [at(150, 60), at(60, 60)] }), matrix, true, A4);
    expect(layout.places).toEqual([
      { x: 150, y: 60 },
      { x: 60, y: 60 },
    ]);
  });

  it('skips a number left empty', () => {
    const layout = manualLayout(
      marks({ centres: [at(10, 10), null, at(30, 10)] }),
      matrix,
      true,
      A4,
    );
    expect(layout.places).toHaveLength(2);
  });

  it('with the scale alone keeps the distances and centres the layout on the sheet', () => {
    const layout = manualLayout(
      marks({
        centres: [
          { x: 1000, y: 500 },
          { x: 1500, y: 500 },
        ],
        segment: [
          { x: 0, y: 0 },
          { x: 500, y: 0 },
        ],
        mm: 100,
      }),
      null,
      false,
      A4,
    );
    expect(layout.places).toEqual([
      { x: 55, y: 148.5 },
      { x: 155, y: 148.5 },
    ]);
  });

  it('corrects the plane by the segment', () => {
    const layout = manualLayout(
      marks({
        centres: [at(100, 100)],
        segment: [at(0, 0), at(100, 0)],
        mm: 110,
      }),
      matrix,
      true,
      A4,
    );
    expect(layout.places).toEqual([{ x: 110, y: 110 }]);
  });

  it('takes the element size from the edge, to half a millimetre, only if it was dragged', () => {
    const edged = { centres: [at(100, 100)], edge: at(143.8, 100) };
    expect(manualLayout(marks(edged), matrix, true, A4).element).toBeNull();
    expect(manualLayout(marks({ ...edged, sized: true }), matrix, true, A4).element).toEqual({
      kind: 'circle',
      size: 87.5,
    });
  });

  it('gives the point of aim as an offset from the centre, up and right', () => {
    const layout = manualLayout(
      marks({ centres: [at(100, 100)], aim: at(90, 80) }),
      matrix,
      true,
      A4,
    );
    expect(layout.aim).toEqual({ up: 20, right: -10 });
  });

  it('cannot place anything without a plane or a scale', () => {
    const none = marks({ centres: [{ x: 1, y: 1 }] });
    expect(canMeasure(none, null)).toBe(false);
    expect(manualLayout(none, null, false, A4).places).toBeNull();
  });
});

describe('turnManual', () => {
  it('turns every mark with the shot', () => {
    const photo = { w: 100, h: 50 };
    const turned = turnManual(
      marks({
        corners: [{ x: 10, y: 0 }],
        segment: [{ x: 20, y: 5 }],
        centres: [{ x: 30, y: 10 }, null],
        aim: { x: 40, y: 15 },
        edge: { x: 50, y: 20 },
      }),
      photo,
      1,
    );
    expect(turned.corners).toEqual([{ x: 50, y: 10 }]);
    expect(turned.segment).toEqual([{ x: 45, y: 20 }]);
    expect(turned.centres).toEqual([{ x: 40, y: 30 }, null]);
    expect(turned.aim).toEqual({ x: 35, y: 40 });
    expect(turned.edge).toEqual({ x: 30, y: 50 });
  });
});
