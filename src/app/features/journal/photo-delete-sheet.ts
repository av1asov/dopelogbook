import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { BottomSheet } from '../../shared/bottom-sheet';

/** Screen 15д: confirms deleting a target photo. */
@Component({
  selector: 'app-photo-delete-sheet',
  imports: [BottomSheet],
  template: `
    <app-bottom-sheet [heading]="heading()" (closed)="cancelled.emit()">
      @if (text(); as line) {
        <p>{{ line }}</p>
      }
      @if (keepHint(); as hint) {
        <label>
          <input type="checkbox" [checked]="keep()" (change)="keep.set(!keep())" />
          <span class="text">
            Оставить в серии группу и СТП
            <small>{{ hint }}</small>
          </span>
        </label>
      }
      <button type="button" class="delete" (click)="confirmed.emit(keep())">Удалить фото</button>
      <button type="button" class="cancel" (click)="cancelled.emit()">Отмена</button>
    </app-bottom-sheet>
  `,
  styles: `
    p {
      margin: 0;
      color: #4c5650;
      font-size: 15px;
    }

    label {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1.5px solid #c9cdc3;
      border-radius: 8px;
      font-size: 15px;
    }

    input {
      flex: none;
      width: 22px;
      height: 22px;
      margin: 0;
      accent-color: #1d221f;
    }

    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    small {
      color: #4c5650;
      font-size: 13px;
    }

    .delete {
      min-height: 52px;
      border: 0;
      border-radius: 8px;
      background: #b2312a;
      color: #fff;
      font-size: 17px;
      font-weight: 700;
    }

    .cancel {
      min-height: 48px;
      border: 2px solid #1d221f;
      border-radius: 8px;
      background: transparent;
      color: #1d221f;
      font-size: 16px;
      font-weight: 700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoDeleteSheet {
  readonly heading = input.required<string>();
  readonly text = input('');
  /** What the photo gave the series; empty when there is nothing to keep. */
  readonly keepHint = input('');

  readonly confirmed = output<boolean>();
  readonly cancelled = output<void>();

  protected readonly keep = signal(true);
}
