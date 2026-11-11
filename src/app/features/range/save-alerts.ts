import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The range shows no «сохранено»: everything is written on every change. Only problems show,
 * a failed write and storage the browser may clear.
 */
@Component({
  selector: 'app-save-alerts',
  imports: [RouterLink],
  template: `
    @if (failed()) {
      <div class="failed" role="alert">
        <span>Не удалось сохранить — освободите место</span>
        <button type="button" (click)="retry.emit()">Повторить</button>
      </div>
    }
    @if (reminder()) {
      <div class="notice backup">
        <span>
          Хранилище не закреплено: iOS может удалить данные.
          <a routerLink="/more">Сделайте резервную копию ›</a>
        </span>
        <button
          type="button"
          class="dismiss"
          aria-label="Скрыть напоминание"
          (click)="dismiss.emit()"
        >
          ✕
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .failed {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 6px 6px 16px;
      background: var(--bad);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
    }

    .failed button {
      flex: none;
      min-height: 40px;
      padding: 0 12px;
      border: 1.5px solid #fff;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font-weight: 700;
    }

    .backup {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 10px 16px 0;
      border-left-color: var(--warn);
      font-size: 14px;
    }

    .backup a {
      color: var(--pen);
      font-weight: 600;
    }

    .dismiss {
      flex: none;
      width: 40px;
      min-height: 40px;
      margin-left: auto;
      border: 0;
      background: transparent;
      color: var(--ink-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveAlerts {
  readonly failed = input(false);
  readonly reminder = input(false);

  readonly retry = output<void>();
  readonly dismiss = output<void>();
}
