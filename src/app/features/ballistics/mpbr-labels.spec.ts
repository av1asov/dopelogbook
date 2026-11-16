import { BallisticInput, mpbr, MpbrResult, MpbrRow, profile } from '../../core/ballistics';
import {
  CHART,
  ChartFact,
  chartLayout,
  ChartLayout,
  factText,
  heightAt,
  intersects,
  journalVerdict,
  LABEL_FONT,
  placeLabels,
  textWidth,
} from './mpbr-labels';

/** The owner's .308 with Igla Shakal 160: the spec's control example, V₀ fitted by the journal. */
const IGLA_160: BallisticInput = {
  dragModel: 'G1',
  bc: 0.391,
  v0: 744,
  sightHeight: 55.5,
  zeroDist: 100,
  atmosphere: { temp: 3.5, pressure: 1013.25, humidity: 0.5 },
  weightGr: 160,
};
/** Scope corrections from the journal, mrad: 4, 8 and 20 clicks of 0,1. */
const JOURNAL = [
  { d: 150, elev: 0.4 },
  { d: 200, elev: 0.8 },
  { d: 300, elev: 2.0 },
];
const CLICK = 0.1;

/** The journal moved to the zero `angle`, with the curve of that zero (see MpbrPage). */
function factsOn(input: BallisticInput, angle: number, zero: number): ChartFact[] {
  const calc = profile(input, angle, 300);
  return JOURNAL.map((p) => ({
    d: p.d,
    h: (-p.elev + (angle - zero) * 1000) * p.d,
    spread: (CLICK / 2) * p.d,
    calc: heightAt(calc, p.d),
  }));
}

/** What the MPBR page hands the chart for a row (see MpbrPage). */
function layoutFor(input: BallisticInput, result: MpbrResult, row: MpbrRow): ChartLayout {
  const ranges = result.rows.flatMap((r) => (!r.line.above && r.line.mpbr ? [r.line.mpbr] : []));
  const axis = Math.ceil((Math.max(...ranges) * 1.2) / 10) * 10;
  const zero = result.current!.angle;
  const journal = factsOn(input, row.line.angle, zero);
  return chartLayout({
    axis,
    radius: result.radius,
    line: row.line,
    points: profile(input, row.line.angle, axis),
    ghost: row.clicks === 0 ? null : profile(input, zero, axis),
    journal,
  });
}

function expectApart(layout: ChartLayout): void {
  const { labels } = layout;
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i].box;
    expect(a.x).toBeGreaterThanOrEqual(CHART.LEFT);
    expect(a.x + a.w).toBeLessThanOrEqual(CHART.W);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.y + a.h).toBeLessThanOrEqual(CHART.BOTTOM + 5);
    for (let j = i + 1; j < labels.length; j++) {
      expect(intersects(a, labels[j].box), `${labels[i].text} / ${labels[j].text}`).toBe(false);
    }
  }
}

describe('MPBR chart labels', () => {
  const result = mpbr(IGLA_160, 100, CLICK);

  it('keeps the labels apart for the owner’s Igla 160, 10 cm zone, ↑5', () => {
    const row = result.rows.find((r) => r.clicks === 5)!;
    expect(row).toBeDefined();
    const layout = layoutFor(IGLA_160, result, row);
    expectApart(layout);
    const kinds = layout.labels.map((l) => l.kind);
    // The point-blank range comes first and always finds room on this chart.
    expect(kinds[0]).toBe('mpbr');
    expect(layout.labels[0].text).toMatch(/^MPBR \d+–\d+$/);
    expect(kinds).toContain('peak');
    // The dashed zero now is labelled somewhere along it.
    expect(kinds).toContain('ghost');
  });

  it('keeps the labels apart for the row over the zone', () => {
    const row = result.rows[result.rows.length - 1];
    expect(row.line.above).not.toBeNull();
    const layout = layoutFor(IGLA_160, result, row);
    expectApart(layout);
    expect(layout.labels.find((l) => l.kind === 'peak')?.text).toMatch(/^над зоной/);
  });

  it('keeps the labels apart on every row of every zone', () => {
    for (const zone of [100, 150, 200]) {
      const r = mpbr(IGLA_160, zone, CLICK);
      for (const row of r.rows) expectApart(layoutFor(IGLA_160, r, row));
    }
  });

  it('moves a label to the next side, and leaves it out when no side is free', () => {
    const bounds = { x: 0, y: 0, w: 200, h: 100 };
    const a = { kind: 'mpbr' as const, text: 'MPBR 194', x: 100, y: 50, r: 4 };
    const b = { kind: 'peak' as const, text: '+5,0 на 110', x: 100, y: 50, r: 4 };
    const c = { kind: 'far' as const, text: '168', x: 100, y: 50, r: 4 };
    const d = { kind: 'near' as const, text: '33', x: 100, y: 50, r: 4 };
    const e = { kind: 'ghost' as const, text: 'сейчас', x: 100, y: 50, r: 4 };
    const placed = placeLabels([a, b, c, d, e], [], [], bounds);
    expect(placed.map((p) => p.kind)).toEqual(['mpbr', 'peak', 'far', 'near']);
    // Above, below, right, left.
    expect(placed[0].box.y + placed[0].box.h).toBeLessThanOrEqual(50 - 4 - 4);
    expect(placed[1].box.y).toBeGreaterThanOrEqual(50 + 4 + 4);
    expect(placed[2].box.x).toBeGreaterThanOrEqual(100 + 4 + 4);
    expect(placed[3].box.x + placed[3].box.w).toBeLessThanOrEqual(100 - 4 - 4);
  });

  it('prefers a side the curve does not cross', () => {
    const bounds = { x: 0, y: 0, w: 200, h: 100 };
    const label = { kind: 'mpbr' as const, text: 'MPBR 194', x: 100, y: 50, r: 4 };
    // A line going up the middle crosses the boxes above and below.
    const curve = [
      { x: 100, y: 0 },
      { x: 100, y: 45 },
      { x: 100, y: 55 },
      { x: 100, y: 100 },
    ];
    const [placed] = placeLabels([label], [], [curve], bounds);
    expect(placed.box.x).toBeGreaterThan(100);
  });

  it('measures the labels at 11 px at least', () => {
    expect(LABEL_FONT).toBeGreaterThanOrEqual(11);
    expect(textWidth('MPBR 3–194')).toBeGreaterThan(50);
  });

  it('puts no numbers by the journal ◆, at any zone', () => {
    for (const zone of [100, 150, 200]) {
      const r = mpbr(IGLA_160, zone, CLICK);
      for (const row of r.rows) {
        const layout = layoutFor(IGLA_160, r, row);
        expect(layout.labels.some((l) => l.text.includes('журнал'))).toBe(false);
        expect(layout.facts.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the journal on the MPBR chart', () => {
  const fact = (d: number, h: number, calc: number | null, spread = 10): ChartFact => ({
    d,
    h,
    spread,
    calc,
  });

  it('tells the shots and the curve on a tap of a ◆', () => {
    expect(factText(fact(200, -60, -63))).toBe(
      '200 м · ваши выстрелы: 6 см ниже точки прицеливания · расчёт: 6,3 см',
    );
    expect(factText(fact(100, 12, -4))).toBe(
      '100 м · ваши выстрелы: 1,2 см выше точки прицеливания · расчёт: 0,4 см ниже',
    );
    expect(factText(fact(400, -300, null))).toBe(
      '400 м · ваши выстрелы: 30 см ниже точки прицеливания',
    );
  });

  it('says the shots agree when every ◆ is within its whisker of the curve', () => {
    expect(journalVerdict([fact(100, 2, 0), fact(200, -60, -55)], 240)).toEqual({
      tone: 'ok',
      text: '◆ ваши выстрелы совпали с расчётом на 100 и 200 м ✓',
    });
  });

  it('names the widest miss and what it does to the range', () => {
    expect(journalVerdict([fact(100, 2, 0), fact(200, -60, -30)], 240)).toEqual({
      tone: 'miss',
      text: '◆ на 200 м ваши выстрелы на 3 см ниже расчёта — MPBR по расчёту завышен',
    });
    expect(journalVerdict([fact(150, 40, 0)], 240).text).toBe(
      '◆ на 150 м ваши выстрелы на 4 см выше расчёта — MPBR по расчёту занижен',
    );
  });

  it('checks the MPBR only by the ◆ up to it + 20 %: farther out is for «Расчёт»', () => {
    const far = fact(600, 900, -1200);
    expect(journalVerdict([fact(100, 2, 0), far], 240).text).toBe(
      '◆ ваши выстрелы совпали с расчётом на 100 м ✓',
    );
  });

  it('is there with nothing to check by, in grey', () => {
    const none = {
      tone: 'none',
      text: '◆ ваших выстрелов на этих дистанциях нет — проверить расчёт нечем',
    };
    expect(journalVerdict([], 240)).toEqual(none);
    expect(journalVerdict([fact(300, -160, -150)], 240)).toEqual(none);
  });

  it('checks the owner’s Igla 160 at 100, 150 and 200 m on the best row of every zone', () => {
    for (const zone of [100, 150, 200]) {
      const r = mpbr(IGLA_160, zone, CLICK);
      const row = r.rows.find((x) => x.clicks === r.best)!;
      const facts = factsOn(IGLA_160, row.line.angle, r.current!.angle);
      const verdict = journalVerdict(facts, row.line.mpbr! * 1.2);
      expect(verdict.tone).not.toBe('none');
      // 300 m is past every one of these ranges.
      expect(verdict.text).not.toContain('300');
    }
  });
});
