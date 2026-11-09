import { Point } from '../ballistics/model';

/** Half of the 44 pt a finger needs to hit a mark. */
export const GRAB_PX = 22;
export const HOLD_MS = 500;
const MOVE_PX = 10;
/** Less than this is a finger trembling, not moving. */
const STILL_PX = 3;
const SETTLE_MS = 300;
const FINE_GAIN = 0.25;

export interface Grabbable extends Point {
  id: number;
  /** Can be moved but not taken away, like a corner of the sheet. */
  fixed?: boolean;
}

export interface MarkRules {
  /** No room for another mark: a touch on empty space adds nothing. */
  full: boolean;
  /** The loupe is switched on: a new mark is aimed and goes where the finger is lifted. */
  aiming: boolean;
  bounds: { w: number; h: number };
}

export type MarkEvent =
  | { type: 'add'; at: Point; reach: number }
  | { type: 'refuse' }
  | { type: 'select'; id: number }
  | { type: 'move'; id: number; at: Point }
  | { type: 'remove'; id: number };

/**
 * One finger on the picture, from touching down to lifting off. Everything is in the pixels of
 * the picture on show; `unit` says how many of them make one screen point. Marks stay exactly
 * where the finger puts them: nothing here looks at what is on the picture.
 */
export class MarkGesture {
  private readonly grabbed: Grabbable | null;
  private readonly reach: number;
  private place: Point;
  private last: Point;
  private stillAt: Point;
  private stillSince: number;
  private dragging = false;
  private strayed = false;
  private fine = false;
  private over = false;

  constructor(
    marks: readonly Grabbable[],
    private readonly start: Point,
    private readonly unit: number,
    now: number,
    private readonly rules: MarkRules,
  ) {
    this.reach = GRAB_PX * unit;
    this.grabbed = closest(marks, start, this.reach);
    this.place = this.grabbed ? { x: this.grabbed.x, y: this.grabbed.y } : start;
    this.last = this.stillAt = start;
    this.stillSince = now;
  }

  /** The mark being dragged. */
  get draggedId(): number | null {
    return this.dragging && this.grabbed ? this.grabbed.id : null;
  }

  /** The point the loupe should look at, if it should be on. */
  get lens(): Point | null {
    if (this.over) return null;
    if (this.dragging) return this.place;
    return !this.grabbed && this.rules.aiming ? this.last : null;
  }

  get holdable(): boolean {
    return !!this.grabbed && !this.grabbed.fixed;
  }

  move(at: Point, now: number): MarkEvent | null {
    if (this.over) return null;
    if (!this.strayed) this.strayed = gap(at, this.start) > MOVE_PX * this.unit;
    if (!this.grabbed) {
      this.last = at;
      return null;
    }
    if (!this.dragging) {
      if (!this.strayed) return null;
      // The mark sets off from here, so it does not jump by the distance already covered.
      this.dragging = true;
      this.last = this.stillAt = at;
      this.stillSince = now;
      return null;
    }
    if (now - this.stillSince >= SETTLE_MS) this.fine = true;
    if (gap(at, this.stillAt) > STILL_PX * this.unit) {
      this.stillAt = at;
      this.stillSince = now;
    }
    const gain = this.fine ? FINE_GAIN : 1;
    const { w, h } = this.rules.bounds;
    this.place = {
      x: clamp(this.place.x + (at.x - this.last.x) * gain, w),
      y: clamp(this.place.y + (at.y - this.last.y) * gain, h),
    };
    this.last = at;
    return { type: 'move', id: this.grabbed.id, at: this.place };
  }

  /** The finger has stayed down long enough. A mark that was moved is not taken away. */
  hold(): MarkEvent | null {
    if (this.over || this.strayed || !this.grabbed || this.grabbed.fixed) return null;
    this.over = true;
    return { type: 'remove', id: this.grabbed.id };
  }

  up(): MarkEvent | null {
    if (this.over) return null;
    this.over = true;
    if (this.grabbed) return this.dragging ? null : { type: 'select', id: this.grabbed.id };
    if (this.strayed && !this.rules.aiming) return null;
    return this.rules.full ? { type: 'refuse' } : { type: 'add', at: this.last, reach: this.reach };
  }
}

function closest(marks: readonly Grabbable[], at: Point, reach: number): Grabbable | null {
  let found: Grabbable | null = null;
  let nearest = reach;
  for (const mark of marks) {
    const distance = gap(mark, at);
    if (distance <= nearest) [nearest, found] = [distance, mark];
  }
  return found;
}

const gap = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value: number, length: number): number => Math.min(length, Math.max(0, value));

/** What an event does to a plain list of points, where a mark's id is its index. */
export function applyMarkEvent(
  points: readonly Point[],
  event: MarkEvent,
  limit: number,
): readonly Point[] {
  switch (event.type) {
    case 'add':
      return points.length < limit ? [...points, event.at] : points;
    case 'move':
      return points.map((point, i) => (i === event.id ? event.at : point));
    case 'remove':
      return points.filter((_, i) => i !== event.id);
    default:
      return points;
  }
}
