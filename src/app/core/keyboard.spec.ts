import { keyboardHeight, revealBy } from './keyboard';

describe('keyboard', () => {
  const open = { height: 500, offsetTop: 0 };

  it('measures the keyboard from the visual viewport', () => {
    expect(keyboardHeight(852, open)).toBe(352);
    expect(keyboardHeight(852, { height: 852, offsetTop: 0 })).toBe(0);
    expect(keyboardHeight(852, { height: 500, offsetTop: 40 })).toBe(312);
  });

  it('leaves a field that is already clear alone', () => {
    expect(revealBy({ top: 100, bottom: 144 }, open)).toBe(0);
  });

  it('scrolls a covered field up with room for its hint', () => {
    expect(revealBy({ top: 600, bottom: 644 }, open)).toBe(240);
  });

  it('never scrolls the top of a tall field out of sight', () => {
    expect(revealBy({ top: 20, bottom: 700 }, open)).toBe(20);
  });
});
