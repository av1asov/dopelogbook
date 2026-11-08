import { ColdShot, PhotoRef } from './model';

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
