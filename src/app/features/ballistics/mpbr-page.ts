import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  clickOf,
  factMpbr,
  fmt,
  JournalPoint,
  journalPoints,
  mpbr,
  MpbrLine,
  fmtSigned,
  MpbrRow,
  numText,
  parseNum,
  plural,
  profile,
  toMrad,
  unitsOf,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { ViewState } from '../../core/view-state';
import { CardSheet } from '../card/card-sheet';
import { BallisticsEmpty } from './ballistics-empty';
import { BallisticsHead } from './ballistics-head';
import { BallisticsState, ZONES } from './ballistics-state';
import { MpbrChart } from './mpbr-chart';
import {
  ChartFact,
  ChartPoint,
  entryText,
  heightAt,
  journalVerdict,
  rangeText,
} from './mpbr-labels';
import { VelocityFitSheet } from './velocity-fit-sheet';

interface Row extends MpbrRow {
  key: string;
  tags: ('сейчас' | 'опт.')[];
  /** Where the bullet really leaves the zone by the journal, m. */
  fact: number | null;
  /** Heights of the journal moved to this zero, mm. */
  facts: ChartFact[];
}

const round5 = (d: number): number => Math.round(d / 5) * 5;

@Component({
  selector: 'app-mpbr-page',
  imports: [BallisticsEmpty, BallisticsHead, CardSheet, MpbrChart, VelocityFitSheet],
  templateUrl: './mpbr-page.html',
  styleUrls: ['./ballistics.css', './mpbr-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MpbrPage {
  protected readonly state = inject(BallisticsState);
  private readonly view = inject(ViewState);
  private readonly store = inject(DiaryStore);

  protected readonly sheetOpen = signal(false);
  protected readonly fitOpen = signal(false);
  protected readonly zones = ZONES;
  protected readonly numText = numText;

  constructor() {
    this.state.tab.set('mpbr');
  }

  protected readonly custom = computed(() => !ZONES.includes(this.state.zone()));
  protected readonly editingZone = signal(false);

  private readonly scope = computed(() => this.state.setup()?.scope ?? null);
  /** One click of the combo's scope, mrad. */
  private readonly click = computed(() => toMrad(clickOf(this.scope()), unitsOf(this.scope())));

  private readonly result = computed(() => {
    const input = this.state.input();
    return input ? { input, result: mpbr(input, this.state.zone(), this.click()) } : null;
  });

  private readonly journal = computed((): JournalPoint[] => {
    const setup = this.state.setup();
    if (!setup?.scope || !setup.ammo) return [];
    const device = this.view.card().device;
    return journalPoints(this.store.diary(), setup.rifle.id, setup.scope.id, setup.ammo.id, device);
  });

  /**
   * h(d) = −elevEff(d)·d + Δθ·d: the journal says how far the bullet fell under the scope's
   * zero; another zero lifts it by the angle between the two. Each ◆ carries the calculated
   * curve of the same zero at its distance.
   */
  private factsFor(line: MpbrLine, zeroAngle: number | null): ChartFact[] {
    const data = this.result();
    const journal = this.journal();
    if (zeroAngle == null || !data || !journal.length) return [];
    const shift = (line.angle - zeroAngle) * 1000;
    const halfClick = this.click() / 2;
    const last = Math.max(...journal.map((p) => p.d));
    const calc = profile(data.input, line.angle, Math.ceil(last / 2) * 2);
    return journal.map((p) => ({
      d: p.d,
      h: (-p.elev + shift) * p.d,
      spread: Math.max(halfClick, p.spread / 2) * p.d,
      calc: heightAt(calc, p.d),
    }));
  }

  /** The calculated curve corrected by the journal's miss, crossing −radius (spec: «факт»). */
  private factExit(line: MpbrLine, facts: readonly ChartFact[], radius: number): number | null {
    const data = this.result();
    if (!data || facts.length < 2) return null;
    const last = facts[facts.length - 1].d;
    const calc = profile(data.input, line.angle, Math.ceil(last / 2) * 2);
    return factMpbr(calc, facts, radius);
  }

  protected readonly rows = computed((): Row[] => {
    const data = this.result();
    if (!data) return [];
    const { result } = data;
    const zeroAngle = result.current?.angle ?? null;
    return result.rows.map((row) => {
      const facts = this.factsFor(row.line, zeroAngle);
      const tags: Row['tags'] = [];
      if (row.clicks === 0) tags.push('сейчас');
      if (row.clicks === result.best) tags.push('опт.');
      return {
        ...row,
        key: `click:${row.clicks}`,
        tags,
        facts,
        fact: this.factExit(row.line, facts, result.radius),
      };
    });
  });

  /** The tapped row while it is in the table, else the best one. */
  protected readonly selected = computed(() => {
    const rows = this.rows();
    const best = this.result()?.result.best;
    return (
      rows.find((r) => r.key === this.state.mpbrRow()) ??
      rows.find((r) => r.clicks === best) ??
      rows.find((r) => r.clicks === 0)
    );
  });

  /** 0…MPBR + 20 % of the longest valid range, so every row fits the same axis. */
  protected readonly axis = computed(() => {
    const ranges = this.rows().flatMap((r) => (!r.line.above && r.line.mpbr ? [r.line.mpbr] : []));
    const best = ranges.length ? Math.max(...ranges) : 200;
    return Math.ceil((best * 1.2) / 10) * 10;
  });

  /**
   * «◆ ваши выстрелы совпали с расчётом на 100 и 200 м ✓», the widest miss, or no shots to check
   * by: on the chosen row, up to its MPBR + 20 % (the whole chart for a row over the zone).
   */
  protected readonly verdict = computed(() => {
    const row = this.selected();
    if (!row) return null;
    const { mpbr: range, above } = row.line;
    const reach = range != null && !above ? range * 1.2 : this.axis();
    return journalVerdict(row.facts, reach);
  });

  private profileOf(line: MpbrLine): ChartPoint[] {
    const data = this.result();
    return data ? profile(data.input, line.angle, this.axis()) : [];
  }

  protected readonly points = computed(() => {
    const row = this.selected();
    return row ? this.profileOf(row.line) : [];
  });

  /** The zero now, dashed, when another row is chosen. */
  protected readonly ghost = computed(() => {
    const row = this.selected();
    const current = this.result()?.result.current;
    return row && current && row.clicks !== 0 ? this.profileOf(current) : null;
  });

  protected readonly radius = computed(() => this.result()?.result.radius ?? 50);

  protected peakText(line: MpbrLine): string {
    return `${line.peak.h >= 0 ? '+' : '−'}${fmt(Math.abs(line.peak.h) / 10, 1)} · ${fmt(line.peak.d, 0)}`;
  }

  protected readonly fmt = fmt;
  protected readonly round5 = round5;

  /** «На 200 м журнал ниже расчёта на 1,8 см — по факту MPBR ≈190 м» */
  protected readonly journalHint = computed(() => {
    const row = this.selected();
    if (!row || row.fact == null || row.line.mpbr == null || row.line.above) return null;
    if (Math.abs(row.fact - row.line.mpbr) <= 10) return null;
    let worst: { d: number; diff: number } | null = null;
    for (const f of row.facts) {
      if (f.calc == null) continue;
      const diff = f.h - f.calc;
      if (!worst || Math.abs(diff) > Math.abs(worst.diff)) worst = { d: f.d, diff };
    }
    if (!worst) return null;
    const side = worst.diff < 0 ? 'ниже' : 'выше';
    return `На ${worst.d} м журнал ${side} расчёта на ${fmt(Math.abs(worst.diff) / 10, 1)} см — по факту MPBR ≈${round5(row.fact)} м.`;
  });

  /**
   * «Как пристрелять: на 100 м поднять прицел на 5 щелчков и проверить, что СТП на +5,0 см выше
   * точки прицеливания. Ближний ноль — 33 м (точность низкая), дальний — 168 м. MPBR 3–194 м.»
   */
  protected readonly practical = computed(() => {
    const row = this.selected();
    const setup = this.state.setup();
    if (!row || !setup) return null;
    const { near, far } = row.line;
    const zeros = [
      // A centimetre at 33 m is 0,3 mrad: good for a rough check on a short range only.
      near != null ? `Ближний ноль — ${fmt(near, 0)} м (точность низкая)` : '',
      far != null ? `дальний — ${fmt(far, 0)} м` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const range = !row.line.above && row.line.mpbr != null ? `MPBR ${rangeText(row.line)} м.` : '';
    return [this.dialText(row, setup.zeroDist), zeros ? `${zeros}.` : '', range]
      .filter(Boolean)
      .join(' ');
  });

  private dialText(row: MpbrRow, zeroDist: number): string {
    if (row.clicks === 0) return 'Это ваш нынешний ноль.';
    const n = Math.abs(row.clicks);
    const dial = `${row.clicks > 0 ? 'поднять' : 'опустить'} прицел на ${n} ${plural(n, 'щелчок', 'щелчка', 'щелчков')}`;
    if (!isFinite(row.atZero)) return `Как пристрелять: ${dial}.`;
    const where = row.atZero >= 0 ? 'выше' : 'ниже';
    return `Как пристрелять: на ${zeroDist} м ${dial} и проверить, что СТП на ${this.atZeroText(row)} см ${where} точки прицеливания.`;
  }

  protected readonly zeroDist = computed(() => this.state.setup()?.zeroDist ?? 100);

  /** «+5,0», cm; «0» for the zero now. */
  protected atZeroText(row: MpbrRow): string {
    if (!isFinite(row.atZero)) return '—';
    return Math.abs(row.atZero) < 0.5 ? '0' : fmtSigned(row.atZero / 10, 1);
  }

  protected clicksText(clicks: number): string {
    return clicks > 0 ? `↑${clicks}` : clicks < 0 ? `↓${-clicks}` : '0';
  }

  /** The table shows the far end only, «194*», with the near one in {@link sightNote}. */
  protected farText(line: MpbrLine): string {
    if (line.mpbr == null) return '—';
    return fmt(line.mpbr, 0) + (line.entry != null ? '*' : '');
  }

  /** «* MPBR от 3 м: прицел выше половины зоны …» under the table. */
  protected readonly sightNote = computed(() => {
    const data = this.result();
    if (!data?.result.sightBelowZone) return null;
    const entries = [
      ...new Set(
        this.rows().flatMap((r) =>
          r.line.entry != null && r.line.mpbr != null && !r.line.above
            ? [Number(entryText(r.line.entry))]
            : [],
        ),
      ),
    ].sort((a, b) => a - b);
    const why = `прицел выше половины зоны (${numText(data.input.sightHeight)} мм > ${fmt(this.radius(), 0)}), первые метры пуля идёт ниже неё.`;
    if (!entries.length) return why[0].toUpperCase() + why.slice(1);
    const from =
      entries.length > 1 ? `${entries[0]}–${entries[entries.length - 1]}` : `${entries[0]}`;
    return `* MPBR от ${from} м: ${why}`;
  });

  protected pickZone(mm: number): void {
    this.editingZone.set(false);
    this.state.zone.set(mm);
  }

  protected setCustomZone(event: Event): void {
    const cm = parseNum((event.target as HTMLInputElement).value);
    if (cm != null && cm >= 2 && cm <= 100) this.state.zone.set(cm * 10);
    this.editingZone.set(false);
  }

  protected select(key: string): void {
    this.state.mpbrRow.set(key);
  }
}
