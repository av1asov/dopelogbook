import { Diary } from '../../core/ballistics';
import { exampleDiary, HAND } from '../../core/ballistics/testing/example-diary';
import {
  DEFAULT_SHARE_OPTIONS,
  publicAmmoName,
  seriesSummary,
  seriesText,
  sessionText,
  shareFileName,
} from './share-text';

const diary: Diary = {
  ...exampleDiary,
  ammo: exampleDiary.ammo.map((a) =>
    a.id === HAND ? { ...a, name: '', bullet: 'SMK 175', powder: 'N140', charge: 44.5 } : a,
  ),
  sessions: exampleDiary.sessions.map((s) => (s.id === 's2' ? { ...s, place: 'Калибр' } : s)),
};
const s2 = diary.sessions.find((s) => s.id === 's2')!;

describe('share text', () => {
  it('writes a series in the four lines of the spec', () => {
    const summary = seriesSummary(diary, s2, 1, 2, DEFAULT_SHARE_OPTIONS, 'MOA');
    expect(summary.title).toBe('Серия 2 · 500 м · 3/4');
    expect(summary.group).toBe('170 мм · 1,2 MOA');
    expect(summary.offset).toBe('СТП ↓50 →15 мм');
    expect(summary.stance).toBe('лёжа, сошки');
    expect(seriesText(summary)).toBe(
      [
        'Серия 2 · 500 м · 3/4',
        'Группа 170 мм (1,2 MOA) · СТП ↓50 →15 мм',
        'Пример: болтовка .308 · SMK 175 · Пример: оптика',
        '05.10.2026 · +9 °C · 752 мм · ветер 2 м/с',
      ].join('\n'),
    );
  });

  it('leaves out what is switched off; the place is off by default', () => {
    const off = { ...DEFAULT_SHARE_OPTIONS, combo: false, conditions: false };
    const summary = seriesSummary(diary, s2, 1, 2, off, 'MRAD');
    expect(summary.group).toBe('170 мм · 0,34 MRAD');
    expect(summary.combo).toBe('');
    expect(summary.conditions).toBe('05.10.2026');
    const placed = seriesSummary(diary, s2, 1, 2, { ...off, place: true }, 'MOA');
    expect(placed.conditions).toBe('05.10.2026 · Калибр');
  });

  it('never gives away a handload recipe', () => {
    const hand = diary.ammo.find((a) => a.id === HAND)!;
    expect(publicAmmoName(hand)).toBe('SMK 175');
    expect(publicAmmoName({ ...hand, bullet: '' })).toBe('самоснаряженный');
    const text = sessionText(diary, s2, [{ si: 0, number: 1 }], DEFAULT_SHARE_OPTIONS, 'MOA');
    expect(text).not.toContain('N140');
    expect(text).not.toContain('44,5');
  });

  it('sums a session up a line per series', () => {
    const text = sessionText(
      diary,
      s2,
      [
        { si: 0, number: 1 },
        { si: 1, number: 2 },
      ],
      DEFAULT_SHARE_OPTIONS,
      'MOA',
    );
    expect(text.split('\n')).toEqual([
      '05.10.2026 · +9 °C · 752 мм',
      'Пример: болтовка .308',
      'Серия 1 · 400 м · 3/3 · СТП ↓10 мм · SMK 175',
      'Серия 2 · 500 м · 3/4 · 170 мм · 1,2 MOA · СТП ↓50 →15 мм · SMK 175',
    ]);
    expect(shareFileName(s2, 2)).toBe('DOPE серия 2 05.10.2026.jpg');
  });
});
