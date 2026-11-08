import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ammoById,
  ammoComparison,
  ammoName,
  barrelLife,
  cardAmmoId,
  coldStats,
  combosOf,
  correctionStability,
  dopePoints,
  fmt,
  fmtSigned,
  GroupEntry,
  groupsOf,
  MOA_PER_MIL,
  niceTicks,
  plural,
  rdate,
  Rifle,
  stanceName,
  stanceStats,
  toUnits,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { ViewState } from '../../core/view-state';
import { RifleButton } from '../../shared/rifle-button';
import { ChartPoint, Scatter } from './scatter';

const MONTHS_IN = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
];
const dateMs = (date: string) => Date.parse(`${date}T12:00:00`);
const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const arrows = (up: number, right: number, digits: number) =>
  [
    up ? `${up > 0 ? '↑' : '↓'}${fmt(Math.abs(up), digits)}` : '',
    right ? `${right > 0 ? '→' : '←'}${fmt(Math.abs(right), digits)}` : '',
  ]
    .filter(Boolean)
    .join(' ') || 'в точку';

@Component({
  selector: 'app-stats-page',
  imports: [RifleButton, RouterLink, Scatter],
  templateUrl: './stats-page.html',
  styleUrl: './stats-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsPage {
  protected readonly store = inject(DiaryStore);
  protected readonly view = inject(ViewState);
  protected readonly settings = inject(SettingsStore);

  private readonly opened = signal<ReadonlySet<string>>(new Set());
  protected readonly tip = signal<string | null>(null);

  protected readonly oneDigit = (v: number) => fmt(v, 1);
  protected readonly noDigits = (v: number) => fmt(v, 0);

  protected readonly unit = computed(() => this.settings.groupUnit());
  private readonly inUnit = computed(() => {
    const moa = this.unit() === 'MOA';
    return (mrad: number) => (moa ? mrad * MOA_PER_MIL : mrad);
  });

  protected isOpen(key: string): boolean {
    return this.opened().has(key);
  }

  protected toggle(key: string): void {
    this.opened.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected toggleUnit(): void {
    void this.settings.setGroupUnit(this.unit() === 'MOA' ? 'MIL' : 'MOA');
  }

  protected readonly progress = computed(() => {
    const rifle = this.view.rifle();
    if (!rifle) return null;
    const groups = groupsOf(this.store.diary(), rifle.id);
    const label = (g: GroupEntry) => stanceName(g.series) || 'не указано';
    const counts = new Map<string, number>();
    for (const g of groups) counts.set(label(g), (counts.get(label(g)) ?? 0) + 1);
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);
    const cls = (name: string) => {
      const index = top.indexOf(name);
      return (index < 0 ? 'c0' : `c${index + 1}`) as ChartPoint['cls'];
    };
    const inUnit = this.inUnit();
    const points: ChartPoint[] = groups.map((g) => ({
      x: dateMs(g.session.date),
      y: inUnit(g.angle),
      cls: cls(label(g)),
      tip: `${rdate(g.session.date)} · ${label(g)} · ${g.series.dist} м · ${fmt(g.series.group, 0)} мм = ${fmt(inUnit(g.angle), 2)} ${this.unit()}`,
    }));
    const legend = top.map((name, i) => ({ name, cls: `c${i + 1}` }));
    if (counts.size > 3) legend.push({ name: 'другие положения', cls: 'c0' });
    return { points, legend, summary: this.progressSummary(groups, top[0], label) };
  });

  /** Recent groups of the most used stance against its earliest ones. */
  private progressSummary(
    groups: GroupEntry[],
    stance: string | undefined,
    label: (g: GroupEntry) => string,
  ): { value: string; text: string } | null {
    if (groups.length < 2 || !stance) return null;
    const inUnit = this.inUnit();
    const ordered = groups
      .filter((g) => label(g) === stance)
      .sort((a, b) => a.session.date.localeCompare(b.session.date));
    const window = Math.max(1, Math.min(3, Math.floor(ordered.length / 2)));
    const value = fmt(inUnit(average(ordered.slice(-window).map((g) => g.angle))), 1);
    if (ordered.length < 2) return { value, text: `${this.unit()} ${stance}` };
    const early = fmt(inUnit(average(ordered.slice(0, window).map((g) => g.angle))), 1);
    const month = MONTHS_IN[Number(ordered[0].session.date.slice(5, 7)) - 1];
    return { value, text: `${this.unit()} ${stance}, в ${month} было ${early}` };
  }

  protected readonly ammo = computed(() => {
    const rifle = this.view.rifle();
    if (!rifle) return null;
    const inUnit = this.inUnit();
    const rows = ammoComparison(this.store.diary(), rifle).map((row) => ({
      name: ammoName(row.ammo),
      values: row.values.map(inUnit),
      avg: inUnit(row.avg),
      n: row.values.length,
    }));
    if (!rows.length) return null;
    const max = Math.max(...rows.map((row) => row.avg));
    const W = 640;
    const rowH = 46;
    const m = { l: 14, r: 70, t: 8, b: 28 };
    const H = m.t + rows.length * rowH + m.b;
    const ticks = niceTicks(0, Math.max(...rows.flatMap((row) => row.values)) * 1.05, 5);
    const end = ticks[ticks.length - 1];
    const X = (v: number) => m.l + (v / end) * (W - m.l - m.r);
    return {
      caption: `Только стол, сошки и мешок · ${rows.map((row) => row.n).join(' и ')} гр.`,
      bars: rows.map((row) => ({
        name: row.name,
        value: fmt(row.avg, 1),
        width: (row.avg / (max * 1.2)) * 100,
      })),
      chart: {
        W,
        H,
        left: m.l,
        right: W - m.r,
        labelX: W - m.r + 8,
        axisY: H - 8,
        ticks: ticks.map((v) => ({ x: X(v), label: fmt(v, 1) })),
        rows: rows.map((row, i) => {
          const y = m.t + i * rowH + 30;
          return {
            name: row.name,
            y,
            nameY: y - 14,
            meanX: X(row.avg),
            meanTop: y - 11,
            meanBottom: y + 11,
            valueY: y + 4,
            countY: y + 18,
            mean: fmt(row.avg, 2),
            count: `${row.n} гр.`,
            dots: row.values.map((v) => ({
              x: X(v),
              tip: `${row.name}: ${fmt(v, 2)} ${this.unit()}`,
            })),
          };
        }),
      },
    };
  });

  protected readonly stances = computed(() => {
    const rifle = this.view.rifle();
    if (!rifle) return [];
    const inUnit = this.inUnit();
    const rows = stanceStats(this.store.diary(), rifle.id);
    const max = Math.max(...rows.map((row) => row.avg));
    return rows.map((row) => ({
      key: `${row.pos}|${row.rest}`,
      name:
        stanceName({
          pos: row.pos as GroupEntry['series']['pos'],
          rest: row.rest as GroupEntry['series']['rest'],
        }) || 'не указано',
      at100: fmt(row.avg * 10, 0),
      at300: fmt(row.avg * 30, 0),
      value: fmt(inUnit(row.avg), 2),
      n: row.n,
      width: Math.max(4, (row.avg / max) * 100),
    }));
  });

  protected readonly ammoChips = computed(() => {
    const diary = this.store.diary();
    return combosOf(diary, this.view.rifle()).map((c) => ({
      id: c.ammoId,
      name: ammoName(ammoById(diary, c.ammoId)),
    }));
  });

  protected readonly stabilityAmmo = computed(() => {
    const rifle = this.view.rifle();
    return rifle ? cardAmmoId(this.store.diary(), rifle, this.view.ammoId()) : null;
  });

  protected readonly stability = computed(() => {
    const rifle = this.view.rifle();
    const ammoId = this.stabilityAmmo();
    if (!rifle || !ammoId) return null;
    const diary = this.store.diary();
    const units = rifle.units;
    const tolerance = fmt(units === 'MOA' ? 0.7 : 0.2, 1);
    const entries = correctionStability(diary, rifle.id, ammoId, units);
    const off = entries.filter((p) => p.deviation != null).length;
    const points: ChartPoint[] = entries.map((p) => ({
      x: p.dist,
      y: p.value,
      cls: p.deviation != null ? 'c2' : 'c1',
      tip: this.stabilityTip(rifle, p),
    }));
    const line = dopePoints(diary, rifle.id, ammoId).elev.map((p) => ({ x: p.d, y: p.v }));
    return {
      points,
      line,
      enough: new Set(entries.map((p) => p.dist)).size >= 2,
      tolerance: `${tolerance} ${units}`,
      units,
      off,
      summary: !entries.length
        ? 'Пока нет серий после пристрелки'
        : off
          ? `${off} ${plural(off, 'серия отличается', 'серии отличаются', 'серий отличаются')} от карты на ${tolerance}+`
          : `Все серии в пределах ${tolerance} ${units} от карты`,
    };
  });

  private stabilityTip(rifle: Rifle, p: ReturnType<typeof correctionStability>[number]): string {
    const parts = [rdate(p.session.date), `${p.dist} м`, `${fmt(p.value, 1)} ${rifle.units}`];
    if (p.session.temp != null) parts.push(`${fmt(p.session.temp, 0)} °C`);
    const stance = stanceName(p.series);
    if (stance) parts.push(stance);
    if (p.deviation != null) parts.push(`от карты ${fmtSigned(p.deviation)}`);
    return parts.join(' · ');
  }

  protected readonly barrel = computed(() => {
    const rifle = this.view.rifle();
    if (!rifle) return null;
    const diary = this.store.diary();
    const line = barrelLife(diary, rifle.id).map((p) => ({
      x: dateMs(p.session.date),
      y: p.total,
      date: p.session.date,
    }));
    const cold = coldStats(diary, rifle.id);
    const coldOffset = cold
      ? `${arrows(toUnits(cold.up, rifle.units), toUnits(cold.right, rifle.units), 2)} ${rifle.units}`
      : '';
    return {
      total: line.at(-1)?.y ?? 0,
      line,
      points: line.map((p): ChartPoint => ({
        x: p.x,
        y: p.y,
        cls: 'c1',
        tip: `${rdate(p.date)} · всего ${fmt(p.y, 0)}`,
      })),
      coldOffset,
      coldTimes: cold?.n ?? 0,
    };
  });
}
