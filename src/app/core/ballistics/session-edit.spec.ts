import { afterSeriesRemoved } from './session-edit';

describe('afterSeriesRemoved', () => {
  it('unlinks photos of the removed series and shifts later ones', () => {
    const photos = [{ id: 'a', si: 0 }, { id: 'b', si: 1 }, { id: 'c', si: 2 }, { id: 'd' }];
    expect(afterSeriesRemoved(1, photos, null).photos).toEqual([
      { id: 'a', si: 0 },
      { id: 'b' },
      { id: 'c', si: 1 },
      { id: 'd' },
    ]);
  });

  it('drops the cold shot with its series', () => {
    expect(afterSeriesRemoved(0, [], { si: 0, offUp: 20 }).coldShot).toBeNull();
  });

  it('shifts the cold shot when an earlier series goes', () => {
    expect(afterSeriesRemoved(0, [], { si: 2, offUp: 20 }).coldShot).toEqual({ si: 1, offUp: 20 });
  });

  it('leaves the cold shot alone when a later series goes', () => {
    expect(afterSeriesRemoved(3, [], { si: 1 }).coldShot).toEqual({ si: 1 });
  });

  it('keeps a standalone cold shot, which belongs to no series', () => {
    const cold = { si: 1, standalone: { dist: 100 } };
    expect(afterSeriesRemoved(1, [], cold).coldShot).toEqual(cold);
  });
});
