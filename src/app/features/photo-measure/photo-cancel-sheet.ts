import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BottomSheet } from '../../shared/bottom-sheet';

/** What leaving the marking screen would lose. */
export type Unsaved = 'photo' | 'shot' | 'marks';

/** Screen 15е: leaving the marking screen after edits made by hand. */
@Component({
  selector: 'app-photo-cancel-sheet',
  imports: [BottomSheet],
  template: `
    <app-bottom-sheet heading="Выйти без сохранения?" (closed)="resumed.emit()">
      <p>{{ text() }}</p>
      <button type="button" class="main" (click)="retake.emit()">Переснять</button>
      <button type="button" class="plain" (click)="keep.emit()">Сохранить фото без разметки</button>
      <button type="button" class="leave" (click)="leave.emit()">{{ leaveLabel() }}</button>
      <button type="button" class="link" (click)="resumed.emit()">Продолжить разметку</button>
    </app-bottom-sheet>
  `,
  styles: `
    p {
      margin: 0;
      color: #4c5650;
      font-size: 15px;
    }

    button {
      min-height: 48px;
      border: 2px solid #1d221f;
      border-radius: 8px;
      background: transparent;
      color: #1d221f;
      font-size: 16px;
      font-weight: 700;
    }

    .main {
      min-height: 52px;
      background: #f1c40f;
      font-size: 17px;
    }

    .leave {
      border: 0;
      background: #b2312a;
      color: #fff;
    }

    .link {
      min-height: 44px;
      border: 0;
      color: #25467a;
      font-weight: 400;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoCancelSheet {
  readonly unsaved = input.required<Unsaved>();

  readonly retake = output<void>();
  readonly keep = output<void>();
  readonly leave = output<void>();
  readonly resumed = output<void>();

  protected readonly text = computed(() => {
    switch (this.unsaved()) {
      case 'photo':
        return 'Фото ещё не сохранено. Если выйти, оно не попадёт в запись.';
      case 'shot':
        return 'Новый снимок ещё не сохранён. Если выйти, останется прежний.';
      case 'marks':
        return 'Правки разметки не сохранены.';
    }
  });

  protected readonly leaveLabel = computed(() =>
    this.unsaved() === 'marks' ? 'Выйти, правки не сохранять' : 'Выйти, фото не сохранять',
  );
}
