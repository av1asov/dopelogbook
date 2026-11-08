import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ammoById,
  ammoName,
  combosOf,
  fmtAng,
  fmtTemp,
  seriesGroupAng,
  seriesStatus,
  Session,
  sessionRounds,
  sessionsOf,
  shortDate,
  stanceName,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { ViewState } from '../../core/view-state';
import { RifleButton } from '../../shared/rifle-button';

@Component({
  selector: 'app-journal-page',
  imports: [RifleButton, RouterLink],
  templateUrl: './journal-page.html',
  styleUrl: './journal-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalPage {
  protected readonly store = inject(DiaryStore);
  protected readonly view = inject(ViewState);
  private readonly settings = inject(SettingsStore);

  protected readonly ammoChips = computed(() => {
    const diary = this.store.diary();
    return combosOf(diary, this.view.rifle()).map((c) => ({
      id: c.ammoId,
      name: ammoName(ammoById(diary, c.ammoId)),
    }));
  });

  protected readonly cards = computed(() => {
    const rifle = this.view.rifle();
    if (!rifle) return [];
    return sessionsOf(this.store.diary(), rifle.id, this.view.ammoId()).map((s) => this.card(s));
  });

  private card(session: Session) {
    const filter = this.view.ammoId();
    const shown = session.series
      .map((series, si) => ({ series, si }))
      .filter(({ series }) => !filter || series.ammoId === filter);

    const stances = new Set(shown.map(({ series }) => stanceName(series)));
    const stance = stances.size === 1 ? [...stances][0] : '';
    const out = shown.filter(({ series }) => !seriesStatus(series).use).length;
    const details = [
      stance,
      session.coldShot ? 'холодный ствол: 1' : '',
      session.photos?.length ? `фото: ${session.photos.length}` : '',
      session.notes ? 'есть заметки' : '',
    ].filter(Boolean);

    return {
      id: session.id,
      date: shortDate(session.date),
      place: session.place || 'Без места',
      open: !!session.open,
      zero: session.rezero ? `ноль ${session.rezero.dist} м` : '',
      summary: [fmtTemp(session.temp), `${sessionRounds(session)} выстр.`]
        .filter(Boolean)
        .join(' · '),
      ammo: this.ammoLines(session, shown),
      details,
      out,
      notes: session.notes ?? '',
    };
  }

  private ammoLines(session: Session, shown: { series: Session['series'][number]; si: number }[]) {
    const diary = this.store.diary();
    const unit = this.settings.groupUnit();
    const byAmmo = new Map<string, typeof shown>();
    for (const entry of shown) {
      byAmmo.set(entry.series.ammoId, [...(byAmmo.get(entry.series.ammoId) ?? []), entry]);
    }
    return [...byAmmo.entries()].map(([ammoId, entries]) => {
      const dists = entries.flatMap(({ series }) => series.dist ?? []);
      const min = Math.min(...dists);
      const max = Math.max(...dists);
      const groups = entries.flatMap(({ si }) => seriesGroupAng(session, si) ?? []);
      return {
        ammoId,
        name: ammoName(ammoById(diary, ammoId)),
        count: `${entries.length} сер.`,
        dist: dists.length ? (min === max ? `${min} м` : `${min}–${max} м`) : '',
        group: groups.length
          ? fmtAng(groups.reduce((sum, v) => sum + v, 0) / groups.length, unit)
          : '',
      };
    });
  }
}
