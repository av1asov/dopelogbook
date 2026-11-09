import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DiaryStore } from '../../core/data/diary-store';
import { photosWithTemplate, templateText } from '../../core/target/measure';
import { TargetPreview } from '../../shared/target-preview';

/** Screen 17. */
@Component({
  selector: 'app-targets-page',
  imports: [RouterLink, TargetPreview],
  templateUrl: './targets-page.html',
  styleUrl: './targets-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetsPage {
  private readonly store = inject(DiaryStore);

  protected readonly cards = computed(() => {
    const { sessions } = this.store.diary();
    return this.store.targets().map((target) => {
      const photos = photosWithTemplate(sessions, target.id);
      return {
        target,
        specs: templateText(target),
        note: photos ? `${photos} фото` : 'не используется',
      };
    });
  });
}
