import { ColdShot, PhotoRef, Series, Session, ZeroEvent } from './model';

/** Keeps photo links and the cold shot pointing at the right series after one is removed. */
export function afterSeriesRemoved(
  index: number,
  photos: readonly PhotoRef[],
  coldShot: ColdShot | null | undefined,
): { photos: PhotoRef[]; coldShot: ColdShot | null } {
  const shifted = photos.map((photo) => {
    if (photo.si === index) return { id: photo.id };
    return photo.si != null && photo.si > index ? { ...photo, si: photo.si - 1 } : { ...photo };
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
