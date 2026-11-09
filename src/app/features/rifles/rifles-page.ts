import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ammoById,
  ammoName,
  combosOf,
  fmt,
  fmtSigned,
  groupStats,
  mainScope,
  MOA_PER_MRAD,
  mountsOf,
  offsetAtZero,
  plural,
  sessionRounds,
  sessionsOf,
  toUnits,
  unitDigits,
  unitsOf,
  zeroText,
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
      const main = mainScope(diary, rifle);
      const atZero = (ammoId: string): string => {
        const value = main ? offsetAtZero(diary, rifle.id, main.id, ammoId) : null;
        return fmtSigned(value == null ? null : toUnits(value, unitsOf(main)), unitDigits(main));
      };
      return {
        rifle,
        scopes: mountsOf(diary, rifle).map(({ mount, scope }) => ({
          id: scope.id,
          name: scope.name,
          mounted: mount.mounted,
          zero: zeroText(diary, rifle.id, scope.id),
        })),
        combos: combosOf(diary, rifle).map((combo) => {
          const group = groupStats(diary, rifle.id, combo.ammoId, true);
          const value = group && (unit === 'MOA' ? group.avg * MOA_PER_MRAD : group.avg);
          return {
            ammoId: combo.ammoId,
            name: ammoName(ammoById(diary, combo.ammoId)),
            velocity: combo.velocity != null ? fmt(combo.velocity, 0) : '—',
            atZero: atZero(combo.ammoId),
            group: value == null ? '—' : fmt(value, 2),
          };
        }),
        rounds: sessions.reduce((sum, s) => sum + sessionRounds(s), 0),
        sessionsText: `${n} ${plural(n, 'стрельба', 'стрельбы', 'стрельб')}`,
      };
    });
  });
}
