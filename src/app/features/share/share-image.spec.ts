import { PhotoMarks } from '../../core/ballistics';
import { marksOverlay } from '../../core/target/measure';
import { frameOf, PHOTO_HEIGHT, SHARE_WIDTH } from './share-image';

/** 10 px per mm, no perspective: plane millimetres are pixels / 10. */
const marks = (holes: { x: number; y: number }[], aim = { x: 1000, y: 1000 }): PhotoMarks => ({
  scale: { source: 'manual', p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, mm: 100 },
  targets: [{ n: 1, aim, holes: holes.map((h) => ({ ...h, auto: false })) }],
});

/** The frame in plane mm. */
function frame(m: PhotoMarks, printed?: { size: number; aim?: { up: number; right: number } }) {
  const f = frameOf(m, marksOverlay(m)[0], printed);
  if (!f) throw new Error('no frame');
  const width = SHARE_WIDTH / f.k;
  return {
    left: f.x0,
    top: f.y0,
    right: f.x0 + width,
    bottom: f.y0 + (width * PHOTO_HEIGHT) / SHARE_WIDTH,
  };
}

/** A tight group of 25 mm around the aim at (100, 100) mm. */
const TIGHT = [
  { x: 960, y: 960 },
  { x: 1040, y: 980 },
  { x: 1000, y: 1080 },
  { x: 1090, y: 1050 },
];

describe('the share picture frame', () => {
  it('shows the whole printed target, not just the group', () => {
    const f = frame(marks(TIGHT), { size: 150 });
    expect(f.left).toBeLessThanOrEqual(100 - 75);
    expect(f.right).toBeGreaterThanOrEqual(100 + 75);
    expect(f.top).toBeLessThanOrEqual(100 - 75);
    expect(f.bottom).toBeGreaterThanOrEqual(100 + 75);
    // Cut to the target with a margin, not the whole sheet.
    expect(f.right - f.left).toBeLessThan(150 * 1.5);
  });

  it('centres on the target when the aim is off its centre', () => {
    // Aim 30 mm above the centre: the centre is at (100, 130) mm.
    const f = frame(marks(TIGHT), { size: 150, aim: { up: 30, right: 0 } });
    expect((f.top + f.bottom) / 2).toBeCloseTo(130, 6);
    expect((f.left + f.right) / 2).toBeCloseTo(100, 6);
  });

  it('keeps holes outside the printed target in the picture', () => {
    const wide = [...TIGHT, { x: 2100, y: 1000 }];
    const f = frame(marks(wide), { size: 100 });
    expect(f.right).toBeGreaterThan(210);
  });

  it('shows at least 200 mm without a template', () => {
    const f = frame(marks(TIGHT));
    expect(f.right - f.left).toBeGreaterThanOrEqual(200);
    expect(f.bottom - f.top).toBeGreaterThanOrEqual(200);
  });
});
