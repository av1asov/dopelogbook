import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** «Разметка · Переснять · Удалить»: the same three on the viewer and in the hold menu. */
@Component({
  selector: 'app-photo-actions',
  template: `
    <button type="button" class="action" [disabled]="!canMeasure()" (click)="measure.emit()">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      </svg>
      Разметка
    </button>
    <label class="action">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
      Переснять
      <input type="file" accept="image/*" hidden (change)="picked($event)" />
    </label>
    <button type="button" class="action danger" (click)="remove.emit()">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
      </svg>
      Удалить
    </button>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .action {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-height: 52px;
      border: 1.5px solid var(--action-rule, #c9cdc3);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font-size: 13px;
    }

    .action:disabled {
      opacity: 0.4;
    }

    .danger {
      border-color: var(--action-danger-rule, #b2312a);
      color: var(--action-danger, #b2312a);
    }

    svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoActions {
  readonly canMeasure = input(true);

  readonly measure = output<void>();
  readonly retake = output<File>();
  readonly remove = output<void>();

  protected picked(event: Event): void {
    const field = event.target as HTMLInputElement;
    const file = field.files?.[0];
    field.value = '';
    if (file) this.retake.emit(file);
  }
}
