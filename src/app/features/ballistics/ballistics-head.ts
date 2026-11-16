import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The head of the three «Баллистика» tabs: the combo, its specs and the tab switch. */
@Component({
  selector: 'app-ballistics-head',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="top">
      <div class="names">
        <span class="rifle">{{ rifle() }}</span>
        <span class="combo">{{ combo() }}</span>
        @if (specs()) {
          <span class="specs num">{{ specs() }}</span>
        }
      </div>
      <button
        type="button"
        class="link"
        aria-label="Выбрать патрон, прицел и опору"
        (click)="pick.emit()"
      >
        Связка ▾
      </button>
    </div>
    <nav class="tabs" role="tablist" aria-label="Баллистика">
      @for (tab of tabs; track tab.path) {
        <a
          role="tab"
          [routerLink]="['/ballistics', tab.path]"
          routerLinkActive="on"
          #active="routerLinkActive"
          [attr.aria-selected]="active.isActive"
          >{{ tab.name }}</a
        >
      }
    </nav>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 3px solid var(--ink);
    }

    .top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .names {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .rifle {
      font-family: var(--f-display);
      font-size: 24px;
      font-weight: 800;
    }

    .combo {
      font-size: 16px;
      font-weight: 600;
    }

    .specs {
      color: var(--ink-2);
      font-size: 13px;
    }

    .link {
      flex: none;
      min-height: 44px;
      padding: 6px 10px;
      border: 1.5px solid var(--ink);
      border-radius: 6px;
      background: var(--card-paper);
      color: var(--ink);
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }

    .tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      height: 36px;
      overflow: hidden;
      border: 1.5px solid var(--ink);
      border-radius: 6px;
    }

    .tabs a {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--card-paper);
      color: var(--ink);
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
    }

    .tabs a + a {
      border-left: 1px solid var(--ink);
    }

    .tabs a.on {
      background: var(--ink);
      color: var(--card-paper);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BallisticsHead {
  readonly rifle = input.required<string>();
  readonly combo = input.required<string>();
  readonly specs = input('');
  readonly pick = output<void>();

  protected readonly tabs = [
    { path: 'card', name: 'Карта' },
    { path: 'calc', name: 'Расчёт' },
    { path: 'mpbr', name: 'MPBR' },
  ];
}
