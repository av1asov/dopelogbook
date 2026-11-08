import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Minus and plus buttons around projected content. */
@Component({
  selector: 'app-stepper',
  template: `
    <button type="button" [attr.aria-label]="minusLabel()" (click)="step.emit(-1)">−</button>
    <span class="value"><ng-content /></span>
    <button type="button" [attr.aria-label]="plusLabel()" (click)="step.emit(1)">+</button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
    }

    button {
      flex: none;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 1.5px solid var(--ink);
      border-radius: 6px;
      background: var(--paper);
      color: var(--ink);
      font-size: 22px;
      font-weight: 700;
    }

    .value {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      min-width: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Stepper {
  readonly minusLabel = input.required<string>();
  readonly plusLabel = input.required<string>();
  readonly step = output<number>();
}
