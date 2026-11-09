import { Session } from './model';
import { afterSeriesRemoved, finishZeroing, zeroEventsAfterRemoval } from './session-edit';

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

describe('zeroEventsAfterRemoval', () => {
  const event = (afterSi: number) => ({ afterSi, dist: 100, scopeId: 'c' });

  it('moves marks at or after the removed series one back', () => {
    expect(zeroEventsAfterRemoval([event(1), event(2), event(5)], 2).map((e) => e.afterSi)).toEqual(
      [1, 1, 4],
    );
  });

  it('keeps a mark before the first series', () => {
    expect(zeroEventsAfterRemoval([event(-1)], 0)[0].afterSi).toBe(-1);
  });
});

describe('finishZeroing', () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const plan = { dist: 100, ammoId: 'a', scopeId: 'c' };
  const zeroing = { kind: 'zeroing' as const, scopeId: 'c', ammoId: 'a', dist: 100, shots: 3 };
  const session: Session = {
    id: 's',
    createdAt: stamp,
    updatedAt: stamp,
    rifleId: 'r',
    date: '2026-11-09',
    zeroing: plan,
    series: [zeroing],
  };

  it('records the last series and marks the zero after it', () => {
    const done = finishZeroing(session, zeroing);
    expect(done.series).toHaveLength(2);
    expect(done.zeroEvents).toEqual([{ afterSi: 1, ...plan }]);
    expect(done).not.toHaveProperty('zeroing');
  });

  it('marks the zero after the last recorded series when nothing new was fired', () => {
    expect(finishZeroing(session, null).zeroEvents).toEqual([{ afterSi: 0, ...plan }]);
    expect(finishZeroing({ ...session, series: [] }, null).zeroEvents).toEqual([
      { afterSi: -1, ...plan },
    ]);
  });
});
