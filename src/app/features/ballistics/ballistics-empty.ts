import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cardScopeId, combosOf } from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { ViewState } from '../../core/view-state';

/** What to add before anything can be shown in «Баллистика». */
@Component({
  selector: 'app-ballistics-empty',
  imports: [RouterLink],
  template: `
    <div class="screen">
      <h1 class="screen-title">Баллистика</h1>
      <div class="card">
        @if (view.rifle(); as rifle) {
          @if (!hasScope()) {
            <b>На «{{ rifle.name }}» нет прицела</b>
            <a class="btn-mark" [routerLink]="['/more/rifles', rifle.id]">Добавить прицел</a>
          } @else if (!hasCombos()) {
            <b>У «{{ rifle.name }}» нет патронов</b>
            <a class="btn-mark" [routerLink]="['/more/rifles', rifle.id]">Привязать патрон</a>
          }
        } @else {
          <b>Дневник пока пустой</b>
          <a class="btn-mark" routerLink="/more/rifles/new">Добавить винтовку</a>
          <a class="btn" routerLink="/more">Импорт из файла</a>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BallisticsEmpty {
  private readonly store = inject(DiaryStore);
  protected readonly view = inject(ViewState);

  protected readonly hasScope = computed(() => {
    const rifle = this.view.rifle();
    return !!rifle && cardScopeId(this.store.diary(), rifle, this.view.scopeId()) != null;
  });

  protected readonly hasCombos = computed(
    () => combosOf(this.store.diary(), this.view.rifle()).length > 0,
  );
}
