import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-placeholder-page',
  template: `<h1>{{ title() }}</h1>`,
  styles: `
    h1 {
      margin: 0;
      padding: 16px;
      font-family: var(--f-display);
      font-weight: 800;
      font-size: 30px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPage {
  readonly title = input.required<string>();
}
