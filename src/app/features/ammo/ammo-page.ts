import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Ammo,
  ammoName,
  comboOf,
  fmt,
  fmtAng,
  groupStats,
  sessionRounds,
  sessionsOf,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';

@Component({
  selector: 'app-ammo-page',
  imports: [RouterLink],
  templateUrl: './ammo-page.html',
  styleUrl: './ammo-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AmmoPage {
  private readonly store = inject(DiaryStore);
  private readonly settings = inject(SettingsStore);

  protected readonly cards = computed(() => {
    const diary = this.store.diary();
    const unit = this.settings.groupUnit();
    return this.store.ammo().map((ammo) => ({
      ammo,
      name: ammoName(ammo),
      handload: ammo.type === 'handload',
      recipe: this.recipe(ammo),
      details: this.details(ammo),
      usage: this.store.rifles().flatMap((rifle) => {
        const combo = comboOf(diary, rifle, ammo.id);
        if (!combo) return [];
        const group = groupStats(diary, rifle.id, ammo.id, true);
        const rounds = sessionsOf(diary, rifle.id, ammo.id).reduce(
          (sum, s) => sum + sessionRounds(s, ammo.id),
          0,
        );
        return [
          {
            rifleId: rifle.id,
            rifle: rifle.name,
            velocity: combo.velocity != null ? `${fmt(combo.velocity, 0)} м/с` : null,
            group: group ? fmtAng(group.avg, unit) : null,
            groups: group ? `${group.n} гр.` : null,
            rounds: `${rounds} выстр.`,
          },
        ];
      }),
    }));
  });

  private recipe(ammo: Ammo): string | null {
    if (ammo.type !== 'handload' || (!ammo.powder && ammo.charge == null)) return null;
    const digits = ammo.chargeUnit === 'г' ? 2 : 1;
    const charge =
      ammo.charge != null
        ? `${fmt(ammo.charge, digits)} ${ammo.chargeUnit || 'gr'}`
        : 'навеска не указана';
    return `${ammo.powder || 'порох не указан'} · ${charge}`;
  }

  private details(ammo: Ammo): string {
    if (ammo.type === 'handload') {
      const coal = ammo.coal != null ? `${fmt(ammo.coal, 1)} мм` : '';
      return [ammo.caliber, ammo.bullet, ammo.brass, ammo.primer, coal].filter(Boolean).join(' · ');
    }
    const lot = ammo.lot ? `партия ${ammo.lot}` : 'партия не указана';
    return [ammo.caliber, ammo.maker, ammo.line, ammo.bullet, lot].filter(Boolean).join(' · ');
  }
}
