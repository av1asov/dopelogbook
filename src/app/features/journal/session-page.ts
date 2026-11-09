import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ammoById,
  ammoName,
  clicksText,
  devName,
  elevEff,
  fmt,
  fmtAng,
  fmtTemp,
  groupAng,
  offText,
  plural,
  rdate,
  scopeById,
  Series,
  seriesGroupAng,
  seriesStatus,
  Session,
  sessionRounds,
  stanceName,
  toUnits,
  unitDigits,
  unitsOf,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { Photo } from '../../shared/photo';
import { PhotoViewer } from '../../shared/photo-viewer';

@Component({
  selector: 'app-session-page',
  imports: [Photo, PhotoViewer, RouterLink],
  templateUrl: './session-page.html',
  styleUrl: './session-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionPage {
  private readonly store = inject(DiaryStore);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);

  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly viewing = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  protected readonly session = computed(() =>
    this.store.diary().sessions.find((s) => s.id === this.id()),
  );

  protected readonly tiles = computed(() => {
    const s = this.session();
    if (!s) return [];
    return [
      { label: 't°', value: fmtTemp(s.temp) || '—' },
      { label: 'давл.', value: s.pressure != null ? fmt(s.pressure, 0) : '—' },
      { label: 'высота', value: s.altitude != null ? `${fmt(s.altitude, 0)} м` : '—' },
      { label: 'выстр.', value: String(sessionRounds(s)) },
    ];
  });

  protected readonly date = computed(() => rdate(this.session()?.date));

  protected readonly standaloneCold = computed(() => {
    const s = this.session();
    if (!s?.coldShot?.standalone) return '';
    return this.coldText(s, s.series[0], s.coldShot.standalone.dist ?? 0);
  });

  /** Zero marks of this session: «100 м под Igla Shakal 160 · Artelv CRS». */
  protected readonly zeroMarks = computed(() => {
    const diary = this.store.diary();
    return (this.session()?.zeroEvents ?? []).map((event) => {
      const parts = [`${event.dist} м`];
      if (event.ammoId) parts[0] += ` под ${ammoName(ammoById(diary, event.ammoId))}`;
      const scope = scopeById(diary, event.scopeId);
      if (scope) parts.push(scope.name);
      return parts.join(' · ');
    });
  });

  /** Zeroing series are summed up in one line: they only count towards barrel life. */
  protected readonly zeroing = computed(() => {
    const series = this.session()?.series.filter((x) => x.kind === 'zeroing') ?? [];
    if (!series.length) return null;
    const sum = (pick: (x: Series) => number | null | undefined) =>
      series.reduce((total, x) => total + (pick(x) ?? 0), 0);
    const clicks = clicksText(
      sum((x) => x.clicksUp),
      sum((x) => x.clicksRight),
    );
    const n = series.length;
    return {
      summary: [
        `${n} ${plural(n, 'серия', 'серии', 'серий')}`,
        `${sum((x) => x.shots)} выстр.`,
        ...(clicks ? [`${clicks} щелч.`] : []),
      ].join(' · '),
    };
  });

  /** Series, with a heading wherever the ammo, device or stance changes. */
  protected readonly rows = computed(() => {
    const s = this.session();
    if (!s) return [];
    let previous = '';
    let number = 0;
    return s.series.flatMap((series, si) => {
      if (series.kind === 'zeroing') return [];
      const key = [series.ammoId, series.scopeId, series.device, series.pos, series.rest].join('|');
      const heading = key === previous ? null : this.heading(series);
      previous = key;
      return [{ si, number: ++number, heading, ...this.describe(s, series, si) }];
    });
  });

  protected readonly generalPhotos = computed(() => {
    const s = this.session();
    return (s?.photos ?? []).filter(
      (p) => p.si == null || !s?.series[p.si] || s.series[p.si].kind === 'zeroing',
    );
  });

  protected async resume(): Promise<void> {
    await this.store.reopenSession(this.id());
    await this.router.navigate(['/range']);
  }

  protected async finish(): Promise<void> {
    await this.store.closeSession(this.id());
  }

  protected async remove(): Promise<void> {
    await this.store.remove('session', this.id());
    await this.router.navigate(['/journal']);
  }

  private heading(series: Series) {
    const diary = this.store.diary();
    const ammo = ammoName(ammoById(diary, series.ammoId));
    const scope = scopeById(diary, series.scopeId)?.name;
    return {
      ammo,
      rest: [scope, devName(series.device), stanceName(series)].filter(Boolean).join(' · '),
    };
  }

  private describe(session: Session, series: Series, si: number) {
    const scope = scopeById(this.store.diary(), series.scopeId);
    const units = unitsOf(scope);
    const digits = unitDigits(scope);
    const shown = (mrad: number | null | undefined) =>
      fmt(mrad == null ? null : toUnits(mrad, units), digits);
    const unit = this.settings.groupUnit();
    const status = seriesStatus(series);
    const effective = elevEff(series);
    const angle = groupAng(series);
    const usable = seriesGroupAng(session, si) != null;
    const cold = session.coldShot;
    return {
      dist: series.dist != null ? `${series.dist} м` : '—',
      use: status.use,
      why: status.why ?? '',
      elev: series.offUp ? `${shown(series.elev)} → ${shown(effective)}` : shown(series.elev),
      wind:
        series.windSpeed != null
          ? `${fmt(series.windSpeed, 0)} м/с · ${shown(series.windCorr)}`
          : '',
      hits: series.shots ? `${series.hits ?? 0}/${series.shots}` : '',
      group: series.group
        ? `${fmt(series.group, 0)} мм${angle != null && usable ? ` · ${fmtAng(angle, unit)}` : ''}`
        : '',
      offset: offText(series, units),
      cold:
        cold?.si === si && !cold.standalone ? this.coldText(session, series, series.dist ?? 0) : '',
      note: series.note ?? '',
      photos: (session.photos ?? []).filter((p) => p.si === si),
    };
  }

  private coldText(session: Session, series: Series | undefined, dist: number): string {
    const units = unitsOf(scopeById(this.store.diary(), series?.scopeId));
    const cold = session.coldShot;
    if (!cold) return '';
    const offset = offText({ dist, offUp: cold.offUp, offRight: cold.offRight }, units);
    return offset || 'смещение не записано';
  }
}
