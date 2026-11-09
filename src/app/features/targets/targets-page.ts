import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DiaryStore } from '../../core/data/diary-store';
import { templateText } from '../../core/target/measure';
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
    const photos = this.store.diary().sessions.flatMap((s) => s.photos ?? []);
    return this.store.targets().map((target) => ({
      target,
      specs: templateText(target),
      note: target.builtin
        ? 'стандартная'
        : `своя · ${photos.filter((p) => p.marks?.templateId === target.id).length} фото`,
    }));
  });
}
