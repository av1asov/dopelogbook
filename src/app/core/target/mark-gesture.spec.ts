import { Point } from '../ballistics/model';
import { applyMarkEvent, Grabbable, MarkEvent, MarkGesture, MarkRules } from './mark-gesture';

const rules = (change: Partial<MarkRules> = {}): MarkRules => ({
  full: false,
  aiming: false,
  bounds: { w: 1000, h: 1000 },
  ...change,
});

const marks = (...points: Point[]): Grabbable[] => points.map((p, id) => ({ ...p, id }));
const touch = (list: Grabbable[], at: Point, change?: Partial<MarkRules>) =>
  new MarkGesture(list, at, 1, 0, rules(change));

describe('MarkGesture', () => {
  it('puts a new mark at the exact fractional point, whatever is under it', () => {
    const at = { x: 123.456, y: 78.125 };
    expect(touch([], at).up()).toEqual({ type: 'add', at, reach: 22 });
  });

  it('selects a mark touched inside its 44 pt zone instead of adding one', () => {
    const list = marks({ x: 100, y: 100 });
    expect(touch(list, { x: 121, y: 100 }).up()).toEqual({ type: 'select', id: 0 });
    expect(touch(list, { x: 123, y: 100 }).up()?.type).toBe('add');
  });

  it('grabs the closest of the marks in reach', () => {
    const list = marks({ x: 100, y: 100 }, { x: 110, y: 100 });
    expect(touch(list, { x: 108, y: 100 }).up()).toEqual({ type: 'select', id: 1 });
  });

  it('keeps the reach in screen points when the picture is zoomed', () => {
    const list = marks({ x: 100, y: 100 });
    const zoomed = new MarkGesture(list, { x: 105, y: 100 }, 0.1, 0, rules());
    expect(zoomed.up()?.type).toBe('add');
  });

  it('refuses a new mark when there is no room for it', () => {
    expect(touch([], { x: 5, y: 5 }, { full: true }).up()).toEqual({ type: 'refuse' });
  });

  it('moves exactly the grabbed mark, without a jump when the drag begins', () => {
    const list = marks({ x: 100, y: 100 }, { x: 300, y: 300 });
    const gesture = touch(list, { x: 302, y: 300 });
    expect(gesture.move({ x: 320, y: 300 }, 16)).toBeNull();
    expect(gesture.draggedId).toBe(1);
    expect(gesture.move({ x: 325.5, y: 310 }, 32)).toEqual({
      type: 'move',
      id: 1,
      at: { x: 305.5, y: 310 },
    });
    expect(gesture.up()).toBeNull();
  });

  it('looks through the loupe at the mark, not at the finger', () => {
    const gesture = touch(marks({ x: 100, y: 100 }), { x: 110, y: 100 });
    gesture.move({ x: 130, y: 100 }, 16);
    gesture.move({ x: 140, y: 100 }, 32);
    expect(gesture.lens).toEqual({ x: 110, y: 100 });
  });

  it('slows the mark down four times after the finger rests for 300 ms', () => {
    const gesture = touch(marks({ x: 100, y: 100 }), { x: 100, y: 100 });
    gesture.move({ x: 120, y: 100 }, 16);
    gesture.move({ x: 140, y: 100 }, 32);
    const slowed = gesture.move({ x: 148, y: 100 }, 400);
    expect(slowed).toEqual({ type: 'move', id: 0, at: { x: 122, y: 100 } });
  });

  it('does not slow down while the finger keeps going', () => {
    const gesture = touch(marks({ x: 100, y: 100 }), { x: 100, y: 100 });
    gesture.move({ x: 120, y: 100 }, 16);
    let event: MarkEvent | null = null;
    for (let i = 1; i <= 40; i++) event = gesture.move({ x: 120 + i * 5, y: 100 }, 16 + i * 16);
    expect(event).toEqual({ type: 'move', id: 0, at: { x: 300, y: 100 } });
  });

  it('removes a mark held still', () => {
    const gesture = touch(marks({ x: 100, y: 100 }), { x: 100, y: 100 });
    expect(gesture.hold()).toEqual({ type: 'remove', id: 0 });
    expect(gesture.up()).toBeNull();
  });

  it('does not remove a mark resting in the middle of a drag', () => {
    const gesture = touch(marks({ x: 100, y: 100 }), { x: 100, y: 100 });
    gesture.move({ x: 130, y: 100 }, 16);
    expect(gesture.hold()).toBeNull();
    expect(gesture.draggedId).toBe(0);
  });

  it('forgives a trembling finger while holding', () => {
    const gesture = touch(marks({ x: 100, y: 100 }), { x: 100, y: 100 });
    gesture.move({ x: 104, y: 103 }, 200);
    expect(gesture.hold()).toEqual({ type: 'remove', id: 0 });
  });

  it('never removes where marks are fixed, such as sheet corners', () => {
    const gesture = touch([{ x: 100, y: 100, id: 0, fixed: true }], { x: 100, y: 100 });
    expect(gesture.holdable).toBe(false);
    expect(gesture.hold()).toBeNull();
  });

  it('adds nothing when the finger slides over empty space', () => {
    const gesture = touch([], { x: 100, y: 100 });
    gesture.move({ x: 150, y: 100 }, 16);
    expect(gesture.up()).toBeNull();
  });

  it('with the loupe on, aims a new mark and puts it where the finger is lifted', () => {
    const gesture = touch([], { x: 100, y: 100 }, { aiming: true });
    expect(gesture.lens).toEqual({ x: 100, y: 100 });
    gesture.move({ x: 150.25, y: 90 }, 16);
    expect(gesture.up()).toEqual({ type: 'add', at: { x: 150.25, y: 90 }, reach: 22 });
  });

  it('keeps a dragged mark on the picture', () => {
    const gesture = touch(marks({ x: 10, y: 10 }), { x: 10, y: 10 });
    gesture.move({ x: 30, y: 10 }, 16);
    expect(gesture.move({ x: -500, y: 10 }, 32)).toMatchObject({ at: { x: 0, y: 10 } });
  });
});

describe('the two points of the scale segment', () => {
  const LIMIT = 2;
  const run = (points: readonly Point[], start: Point) => {
    const gesture = new MarkGesture(
      marks(...points),
      start,
      1,
      0,
      rules({ full: points.length >= LIMIT }),
    );
    const event = gesture.up();
    return event ? applyMarkEvent(points, event, LIMIT) : points;
  };

  it('a third touch leaves both points where they are', () => {
    const points = [
      { x: 10.5, y: 20.25 },
      { x: 400.75, y: 20.5 },
    ];
    expect(run(points, { x: 200, y: 200 })).toBe(points);
  });

  it('dragging moves only the grabbed point', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 400, y: 20 },
    ];
    const moved = applyMarkEvent(points, { type: 'move', id: 1, at: { x: 390.5, y: 21 } }, LIMIT);
    expect(moved).toEqual([points[0], { x: 390.5, y: 21 }]);
  });

  it('after holding one point away, the next touch puts it back', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 400, y: 20 },
    ];
    const left = applyMarkEvent(points, { type: 'remove', id: 0 }, LIMIT);
    expect(left).toEqual([points[1]]);
    expect(run(left, { x: 33.3, y: 44.4 })).toEqual([points[1], { x: 33.3, y: 44.4 }]);
  });
});
