import { ColdShot, PhotoRef, PhotoTarget, Series, Session, ZeroEvent } from './model';

const shiftTarget =
  (index: number) =>
  (target: PhotoTarget): PhotoTarget => {
    if (target.si == null || target.si < index) return target;
    if (target.si > index) return { ...target, si: target.si - 1 };
    const { si: _si, ...unlinked } = target;
    return unlinked;
  };

/** Keeps photo links and the cold shot pointing at the right series after one is removed. */
export function afterSeriesRemoved(
  index: number,
  photos: readonly PhotoRef[],
  coldShot: ColdShot | null | undefined,
): { photos: PhotoRef[]; coldShot: ColdShot | null } {
  const shifted = photos.map((photo) => {
    const moved = photo.marks?.targets.some((t) => t.si != null)
      ? {
          ...photo,
          marks: { ...photo.marks, targets: photo.marks.targets.map(shiftTarget(index)) },
        }
      : photo;
    if (moved.si === index) {
      const { si: _si, ...unlinked } = moved;
      return unlinked;
    }
    return moved.si != null && moved.si > index ? { ...moved, si: moved.si - 1 } : { ...moved };
  });
  if (!coldShot) return { photos: shifted, coldShot: null };
  if (coldShot.si === index && !coldShot.standalone) return { photos: shifted, coldShot: null };
  return {
    photos: shifted,
    coldShot: coldShot.si > index ? { ...coldShot, si: coldShot.si - 1 } : coldShot,
  };
}

/** Keeps zero marks after the same series when one is removed. */
export function zeroEventsAfterRemoval(events: readonly ZeroEvent[], index: number): ZeroEvent[] {
  return events.map((event) =>
    event.afterSi >= index ? { ...event, afterSi: event.afterSi - 1 } : { ...event },
  );
}

/**
 * Ends zeroing: `series` is the last zeroing series, or null when all of them are already
 * recorded. The zero counts from the next series on.
 */
export function finishZeroing(session: Session, series: Series | null): Session {
  const { zeroing: plan, ...rest } = session;
  const list = series ? [...session.series, series] : session.series;
  if (!plan) return { ...rest, series: list };
  return {
    ...rest,
    series: list,
    zeroEvents: [...(session.zeroEvents ?? []), { afterSi: list.length - 1, ...plan }],
  };
}
