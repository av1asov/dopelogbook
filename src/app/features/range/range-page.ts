import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DiaryStore } from '../../core/data/diary-store';
import { NewSession } from './new-session';
import { RangeSession } from './range-session';

/** The «Рубеж» tab: the open session, or the form that starts one. */
@Component({
  selector: 'app-range-page',
  imports: [NewSession, RangeSession, RouterLink],
  template: `
    @if (open(); as session) {
      <app-range-session [session]="session" />
    } @else if (store.rifles().length) {
      <app-new-session />
    } @else {
      <div class="screen">
        <h1 class="screen-title">DOPE</h1>
        <div class="card">
          <b>Дневник пока пустой</b>
          <span class="hint">
            Заведите винтовку и патроны или перенесите записи из резервной копии.
          </span>
          <a class="btn-mark" routerLink="/more/rifles/new">Добавить винтовку</a>
          <a class="btn" routerLink="/more">Импорт из файла</a>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangePage {
  protected readonly store = inject(DiaryStore);
  protected readonly open = computed(() => this.store.diary().sessions.find((s) => s.open));
}
