import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DiaryStore } from '../core/data/diary-store';
import { ViewState } from '../core/view-state';

/** Shows the current rifle; with several rifles a tap moves to the next one. */
@Component({
  selector: 'app-rifle-button',
  template: `
    @if (view.rifle(); as rifle) {
      <button type="button" class="chip strong" (click)="view.nextRifle()">
        {{ rifle.name }}{{ several() ? ' ▾' : '' }}
      </button>
    }
  `,
  styles: `
    .strong {
      max-width: 200px;
      overflow: hidden;
      background: var(--sheet);
      font-size: 14px;
      font-weight: 600;
      text-overflow: ellipsis;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RifleButton {
  private readonly store = inject(DiaryStore);
  protected readonly view = inject(ViewState);
  protected readonly several = computed(() => this.store.rifles().length > 1);
}
