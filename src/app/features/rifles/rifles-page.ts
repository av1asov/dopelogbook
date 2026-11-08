import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ammoById,
  ammoName,
  combosOf,
  fmt,
  fmtSigned,
  groupStats,
  MOA_PER_MIL,
  numText,
  offsetAtZero,
  plural,
  Rifle,
  sessionRounds,
  sessionsOf,
  shortDate,
  zeroInfo,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';

@Component({
  selector: 'app-rifles-page',
  imports: [RouterLink],
  templateUrl: './rifles-page.html',
  styleUrl: './rifles-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RiflesPage {
  private readonly store = inject(DiaryStore);
  protected readonly settings = inject(SettingsStore);

  protected readonly cards = computed(() => {
    const diary = this.store.diary();
    const unit = this.settings.groupUnit();
    return this.store.rifles().map((rifle) => {
      const sessions = sessionsOf(diary, rifle.id);
      const n = sessions.length;
      return {
        rifle,
        zero: this.zeroParts(rifle),
        scope: [
          rifle.scope,
          `${rifle.units}${rifle.click != null ? `, щелчок ${numText(rifle.click)}` : ''}`,
        ]
          .filter(Boolean)
          .join(' · '),
        combos: combosOf(diary, rifle).map((combo) => {
          const group = groupStats(diary, rifle.id, combo.ammoId, true);
          const value = group && (unit === 'MOA' ? group.avg * MOA_PER_MIL : group.avg);
          return {
            ammoId: combo.ammoId,
            name: ammoName(ammoById(diary, combo.ammoId)),
            velocity: combo.velocity != null ? fmt(combo.velocity, 0) : '—',
            atZero: fmtSigned(offsetAtZero(diary, rifle.id, combo.ammoId)),
            group: value == null ? '—' : fmt(value, 2),
          };
        }),
        rounds: sessions.reduce((sum, s) => sum + sessionRounds(s), 0),
        sessionsText: `${n} ${plural(n, 'стрельба', 'стрельбы', 'стрельб')}`,
      };
    });
  });

  private zeroParts(rifle: Rifle): { dist: string; rest: string } | null {
    const diary = this.store.diary();
    const zero = zeroInfo(diary, rifle.id);
    if (!zero) return null;
    if (zero.derived) return { dist: `${zero.dist} м`, rest: 'по журналу' };
    const ammo = ammoName(ammoById(diary, zero.ammoId));
    return { dist: `${zero.dist} м`, rest: `под ${ammo} · ${shortDate(zero.date)}` };
  }
}
