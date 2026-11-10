import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * A number that can be negative. The iPhone decimal keypad has no minus key,
 * so the sign lives on a button next to the field.
 */
@Component({
  selector: 'app-signed-input',
  template: `
    <button
      type="button"
      class="sign"
      [attr.aria-label]="label() + ': сменить знак'"
      (click)="toggle()"
    >
      {{ negative() ? minus() : plus() }}
    </button>
    <input
      class="input num"
      inputmode="decimal"
      autocomplete="off"
      [attr.aria-label]="label()"
      [attr.placeholder]="placeholder()"
      [value]="text()"
      (input)="edit($event)"
      (blur)="onTouched()"
    />
  `,
  styles: `
    :host {
      display: flex;
      gap: 3px;
      min-width: 0;
    }

    .sign {
      flex: none;
      width: 34px;
      height: 44px;
      padding: 0;
      border: 1.5px solid var(--ink);
      border-radius: 4px;
      background: transparent;
      color: var(--ink);
      font-size: 17px;
      font-weight: 700;
    }

    input {
      font-weight: 700;
    }
  `,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SignedInput), multi: true },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignedInput implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly plus = input('+');
  readonly minus = input('−');
  readonly placeholder = input<string | null>(null);

  protected readonly negative = signal(false);
  protected readonly text = signal('');

  private onChange: (value: string) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    const raw = value ?? '';
    this.negative.set(raw.startsWith('-'));
    this.text.set(raw.replace(/^-/, ''));
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  protected toggle(): void {
    this.negative.update((value) => !value);
    this.emit();
  }

  protected edit(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.emit();
  }

  private emit(): void {
    const text = this.text();
    this.onChange(text ? `${this.negative() ? '-' : ''}${text}` : '');
  }
}
