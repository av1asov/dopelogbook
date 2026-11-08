import { niceTicks } from './chart';

describe('niceTicks', () => {
  it('covers the range with round steps', () => {
    expect(niceTicks(0, 3.15, 4)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0, 90, 4)).toEqual([0, 25, 50, 75, 100]);
  });

  it('handles an empty range', () => {
    expect(niceTicks(0, 0, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});
