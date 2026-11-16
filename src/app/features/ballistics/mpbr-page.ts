import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  clickOf,
  fmt,
  JournalPoint,
  journalPoints,
  mpbr,
  MpbrLine,
  numText,
  parseNum,
  profile,
  toMrad,
  toUnits,
  unitsOf,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { ViewState } from '../../core/view-state';
import { CardSheet } from '../card/card-sheet';
import { BallisticsEmpty } from './ballistics-empty';
import { BallisticsHead } from './ballistics-head';
import { BallisticsState, ZONES } from './ballistics-state';
import { ChartFact, ChartPoint, MpbrChart } from './mpbr-chart';
import { VelocityFitSheet } from './velocity-fit-sheet';

interface Row {
  key: string;
  line: MpbrLine;
  tag: 'опт.' | 'сейчас' | '';
  /** Where the bullet really leaves the zone by the journal, m. */
  fact: number | null;
  /** Heights of the journal moved to this zero, mm. */
  facts: ChartFact[];
}

const round5 = (d: number): number => Math.round(d / 5) * 5;

/** Height of the profile at `d`, between its points. */
function heightAt(points: readonly ChartPoint[], d: number): number | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (d >= a.d && d <= b.d) return a.h + ((b.h - a.h) * (d - a.d)) / (b.d - a.d);
  }
  return null;
}

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

  private readonly result = computed(() => {
    const input = this.state.input();
    return input ? { input, result: mpbr(input, this.state.zone()) } : null;
  });

  private readonly scope = computed(() => this.state.setup()?.scope ?? null);

  private readonly journal = computed((): JournalPoint[] => {
    const setup = this.state.setup();
    if (!setup?.scope || !setup.ammo) return [];
    const device = this.view.card().device;
    return journalPoints(this.store.diary(), setup.rifle.id, setup.scope.id, setup.ammo.id, device);
  });

  /**
   * h(d) = −elevEff(d)·d + Δθ·d: the journal says how far the bullet fell under the scope's
   * zero; another zero lifts it by the angle between the two.
   */
  private factsFor(line: MpbrLine, zeroAngle: number | null): ChartFact[] {
    if (zeroAngle == null) return [];
    const shift = (line.angle - zeroAngle) * 1000;
    const halfClick = toMrad(clickOf(this.scope()), unitsOf(this.scope())) / 2;
    return this.journal().map((p) => ({
      d: p.d,
      h: (-p.elev + shift) * p.d,
      spread: Math.max(halfClick, p.spread / 2) * p.d,
    }));
  }

  /** Where the journal heights drop through −radius, when there are points on both sides. */
  private factExit(facts: readonly ChartFact[], radius: number): number | null {
    for (let i = 1; i < facts.length; i++) {
      const a = facts[i - 1];
      const b = facts[i];
      if (a.h >= -radius && b.h < -radius) {
        return a.d + ((-radius - a.h) / (b.h - a.h)) * (b.d - a.d);
      }
    }
    return null;
  }

  protected readonly rows = computed((): Row[] => {
    const data = this.result();
    if (!data) return [];
    const { result } = data;
    const zeroAngle = result.current?.angle ?? null;
    const make = (key: string, line: MpbrLine, tag: Row['tag']): Row => {
      const facts = this.factsFor(line, zeroAngle);
      return { key, line, tag, facts, fact: this.factExit(facts, result.radius) };
    };
    const rows = [
      ...result.nears.map((n) => make(`near:${n.dist}`, n.line, '')),
      make('optimal', result.optimal, 'опт.'),
      ...(result.current ? [make('current', result.current, 'сейчас')] : []),
    ];
    return rows.sort((a, b) => (a.line.near ?? 0) - (b.line.near ?? 0));
  });

  protected readonly selected = computed(() => {
    const rows = this.rows();
    return (
      rows.find((r) => r.key === this.state.mpbrRow()) ?? rows.find((r) => r.key === 'optimal')
    );
  });

  /** 0…MPBR + 20 % of the longest valid range, so every row fits the same axis. */
  protected readonly axis = computed(() => {
    const best = this.result()?.result.optimal.mpbr ?? 200;
    return Math.ceil((best * 1.2) / 10) * 10;
  });

  private profileOf(line: MpbrLine): ChartPoint[] {
    const data = this.result();
    return data ? profile(data.input, line.angle, this.axis()) : [];
  }

  protected readonly points = computed(() => {
    const row = this.selected();
    return row ? this.profileOf(row.line) : [];
  });

  protected readonly ghost = computed(() => {
    const row = this.selected();
    const optimal = this.result()?.result.optimal;
    return row && optimal && row.key !== 'optimal' ? this.profileOf(optimal) : null;
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
    const points = this.points();
    let worst: { d: number; diff: number } | null = null;
    for (const f of row.facts) {
      const calc = heightAt(points, f.d);
      if (calc == null) continue;
      const diff = f.h - calc;
      if (!worst || Math.abs(diff) > Math.abs(worst.diff)) worst = { d: f.d, diff };
    }
    if (!worst) return null;
    const side = worst.diff < 0 ? 'ниже' : 'выше';
    return `На ${worst.d} м журнал ${side} расчёта на ${fmt(Math.abs(worst.diff) / 10, 1)} см — по факту MPBR ≈${round5(row.fact)} м.`;
  });

  /** «Чтобы стрелять с MPBR 204 м: на 100 м попадание на 5,0 см выше …» */
  protected readonly practical = computed(() => {
    const row = this.selected();
    const setup = this.state.setup();
    const current = this.result()?.result.current;
    if (!row || !setup) return null;
    if (row.key === 'current') return 'Это ваш нынешний ноль.';
    const zeroDist = setup.zeroDist;
    const at = heightAt(this.points(), zeroDist);
    if (at == null || !current) return null;
    const units = unitsOf(setup.scope);
    const clicks = Math.round(
      toUnits((row.line.angle - current.angle) * 1000, units) / clickOf(setup.scope),
    );
    const where = at >= 0 ? 'выше' : 'ниже';
    const goal =
      row.line.above || row.line.mpbr == null
        ? 'Для этого нуля'
        : `Чтобы стрелять с MPBR ${fmt(row.line.mpbr, 0)} м`;
    const dial = clicks ? `${clicks > 0 ? '↑' : '↓'}${Math.abs(clicks)} щелч.` : 'без щелчков';
    return `${goal}: на ${zeroDist} м попадание на ${fmt(Math.abs(at) / 10, 1)} см ${where} точки прицеливания — от нынешнего нуля это ${dial}`;
  });

  protected readonly sightNote = computed(() => {
    const data = this.result();
    if (!data?.result.sightBelowZone) return null;
    return `Прицел выше половины зоны (${numText(data.input.sightHeight)} мм > ${fmt(this.radius(), 0)}): первые метры пуля идёт ниже зоны.`;
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
