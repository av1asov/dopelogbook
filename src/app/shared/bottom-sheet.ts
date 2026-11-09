import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** A sheet that slides over the screen; tapping outside it closes it. */
@Component({
  selector: 'app-bottom-sheet',
  template: `
    <div class="shade" (click)="closed.emit()"></div>
    <section role="dialog" [attr.aria-label]="heading()">
      <span class="grip"></span>
      <h2>{{ heading() }}</h2>
      <ng-content />
    </section>
  `,
  styles: `
    .shade {
      position: fixed;
      inset: 0;
      z-index: 21;
      background: rgb(0 0 0 / 55%);
    }

    section {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 22;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 90%;
      padding: 8px 16px calc(14px + env(safe-area-inset-bottom, 0px));
      border-radius: 16px 16px 0 0;
      background: #f5f6f2;
      color: #1d221f;
    }

    .grip {
      align-self: center;
      width: 40px;
      height: 5px;
      border-radius: 3px;
      background: #c9cdc3;
    }

    h2 {
      margin: 0;
      font-family: var(--f-display);
      font-size: 20px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomSheet {
  readonly heading = input.required<string>();
  readonly closed = output<void>();
}
