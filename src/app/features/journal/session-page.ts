import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ammoById,
  ammoName,
  devName,
  elevEff,
  fmt,
  fmtAng,
  fmtTemp,
  groupAng,
  offText,
  rdate,
  rifleById,
  Series,
  seriesGroupAng,
  seriesStatus,
  Session,
  sessionRounds,
  stanceName,
  Units,
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

  protected readonly units = computed<Units>(() => {
    const session = this.session();
    return rifleById(this.store.diary(), session?.rifleId)?.units ?? 'MIL';
  });

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
    return s?.coldShot?.standalone ? this.coldText(s, s.coldShot.standalone.dist ?? 0) : '';
  });

  /** Series, with a heading wherever the ammo, device or stance changes. */
  protected readonly rows = computed(() => {
    const s = this.session();
    if (!s) return [];
    let previous = '';
    return s.series.map((series, si) => {
      const key = [series.ammoId, series.device, series.pos, series.rest].join('|');
      const heading = key === previous ? null : this.heading(series);
      previous = key;
      return { si, heading, ...this.describe(s, series, si) };
    });
  });

  protected readonly generalPhotos = computed(() => {
    const s = this.session();
    return (s?.photos ?? []).filter((p) => p.si == null || !s?.series[p.si]);
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
    const ammo = ammoName(ammoById(this.store.diary(), series.ammoId));
    return { ammo, rest: [devName(series.device), stanceName(series)].filter(Boolean).join(' · ') };
  }

  private describe(session: Session, series: Series, si: number) {
    const units = this.units();
    const unit = this.settings.groupUnit();
    const status = seriesStatus(series);
    const effective = elevEff(series, units);
    const angle = groupAng(series);
    const usable = seriesGroupAng(session, si) != null;
    const cold = session.coldShot;
    return {
      dist: series.dist != null ? `${series.dist} м` : '—',
      use: status.use,
      why: status.why ?? '',
      elev: series.offUp ? `${fmt(series.elev)} → ${fmt(effective)}` : fmt(series.elev),
      wind:
        series.windSpeed != null ? `${fmt(series.windSpeed, 0)} м/с · ${fmt(series.windCorr)}` : '',
      hits: series.shots ? `${series.hits ?? 0}/${series.shots}` : '',
      group: series.group
        ? `${fmt(series.group, 0)} мм${angle != null && usable ? ` · ${fmtAng(angle, unit)}` : ''}`
        : '',
      offset: offText(series, units),
      cold: cold?.si === si && !cold.standalone ? this.coldText(session, series.dist ?? 0) : '',
      note: series.note ?? '',
      photos: (session.photos ?? []).filter((p) => p.si === si),
    };
  }

  private coldText(session: Session, dist: number): string {
    const units = this.units();
    const cold = session.coldShot;
    if (!cold) return '';
    const offset = offText({ ammoId: '', dist, offUp: cold.offUp, offRight: cold.offRight }, units);
    return offset || 'смещение не записано';
  }
}
