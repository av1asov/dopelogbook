import { ChangeDetectionStrategy, Component, input, output, signal, OnInit } from '@angular/core';
import { TargetTemplate } from '../../core/ballistics';
import { templateText } from '../../core/target/measure';
import { TargetPreview } from '../../shared/target-preview';

/** Screen 15в: which target is in the photo. */
@Component({
  selector: 'app-target-picker',
  imports: [TargetPreview],
  template: `
    <div class="shade" (click)="closed.emit()"></div>
    <section role="dialog" aria-label="Выбор мишени для фото">
      <span class="grip"></span>
      <h2>Какая мишень на фото?</h2>
      <div class="list">
        @for (t of ordered(); track t.id) {
          <label [class.on]="picked() === t.id">
            <input
              type="radio"
              name="target"
              [checked]="picked() === t.id"
              (change)="picked.set(t.id)"
            />
            <app-target-preview [template]="t" [length]="42" />
            <span class="text">
              <b>{{ t.name }}</b>
              <span>{{ note(t) }}</span>
            </span>
          </label>
        }
        <label [class.on]="picked() === ''">
          <input type="radio" name="target" [checked]="picked() === ''" (change)="picked.set('')" />
          <span class="text">
            <b>Без шаблона</b>
            <span>масштаб и точку отмечу вручную</span>
          </span>
        </label>
      </div>
      <button type="button" class="create" (click)="create.emit()">
        + Новая мишень с этого фото
      </button>
      <button type="button" class="done" (click)="chosen.emit(picked())">Готово</button>
    </section>
  `,
  styles: `
    .shade {
      position: fixed;
      inset: 0;
      z-index: 21;
      background: rgb(15 18 16 / 70%);
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

    .list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
    }

    label {
      display: flex;
      flex: none;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 8px 12px;
      border: 1.5px solid #c9cdc3;
      border-radius: 8px;
    }

    label.on {
      border: 2px solid #1d221f;
    }

    input {
      width: 20px;
      height: 20px;
      margin: 0;
      accent-color: #1d221f;
    }

    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      font-size: 13px;
      color: #4c5650;
    }

    .text b {
      color: #1d221f;
      font-size: 16px;
    }

    .create {
      min-height: 48px;
      border: 2px dashed #25467a;
      border-radius: 8px;
      background: transparent;
      color: #25467a;
      font-size: 16px;
      font-weight: 700;
    }

    .done {
      min-height: 52px;
      border: 2px solid #1d221f;
      border-radius: 8px;
      background: #f1c40f;
      color: #1d221f;
      font-size: 17px;
      font-weight: 700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetPicker implements OnInit {
  readonly templates = input.required<readonly TargetTemplate[]>();
  readonly selected = input('');
  readonly lastUsed = input<string | null>(null);
  readonly similar = input<readonly string[]>([]);

  readonly chosen = output<string>();
  readonly create = output<void>();
  readonly closed = output<void>();

  protected readonly picked = signal('');

  ngOnInit(): void {
    this.picked.set(this.selected());
  }

  /** Those that look like the photo first, then the one used last time. */
  protected ordered(): TargetTemplate[] {
    const rank = (t: TargetTemplate) =>
      this.similar().includes(t.id) ? 0 : t.id === this.lastUsed() ? 1 : 2;
    return [...this.templates()].sort((a, b) => rank(a) - rank(b));
  }

  protected note(t: TargetTemplate): string {
    const notes = [
      this.similar().includes(t.id) ? 'похожа на фото' : '',
      t.id === this.lastUsed() ? 'в прошлый раз' : '',
    ].filter(Boolean);
    return notes.length ? notes.join(' · ') : templateText(t);
  }
}
