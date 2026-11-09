import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { numText, scopeTypeName, unitLabel, zeroText } from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';

@Component({
  selector: 'app-scopes-page',
  imports: [RouterLink],
  templateUrl: './scopes-page.html',
  styleUrl: './scopes-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopesPage {
  private readonly store = inject(DiaryStore);

  protected readonly cards = computed(() => {
    const diary = this.store.diary();
    return this.store.scopes().map((scope) => ({
      scope,
      type: scopeTypeName(scope.type),
      thermal: scope.type === 'thermal',
      specs: [
        scope.magnification,
        `${unitLabel(scope.units)}${scope.click != null ? `, щелчок ${numText(scope.click)}` : ''}`,
      ]
        .filter(Boolean)
        .join(' · '),
      rifles: this.store.rifles().flatMap((rifle) => {
        const mount = rifle.mounts.find((m) => m.scopeId === scope.id);
        if (!mount) return [];
        return [
          {
            id: rifle.id,
            name: rifle.name,
            mounted: mount.mounted,
            zero: zeroText(diary, rifle.id, scope.id),
          },
        ];
      }),
    }));
  });
}
