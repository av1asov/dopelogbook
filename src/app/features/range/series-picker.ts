import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Ammo, ammoById, ammoName, POSITIONS, RESTS, Rifle } from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';

export type PickerForm = FormGroup<{
  ammoId: FormControl<string>;
  device: FormControl<string>;
  pos: FormControl<string>;
  rest: FormControl<string>;
}>;

/** Bottom sheet: changes apply to the current series and carry over to the next ones. */
@Component({
  selector: 'app-series-picker',
  imports: [ReactiveFormsModule],
  templateUrl: './series-picker.html',
  styleUrl: './series-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeriesPicker {
  private readonly store = inject(DiaryStore);

  readonly form = input.required<PickerForm>();
  readonly rifle = input.required<Rifle>();
  readonly seriesNumber = input.required<number>();
  readonly closed = output<void>();

  protected readonly positions = POSITIONS;
  protected readonly rests = RESTS;

  protected ammoList(): Ammo[] {
    const diary = this.store.diary();
    return this.rifle().combos.flatMap((combo) => ammoById(diary, combo.ammoId) ?? []);
  }

  protected name(ammo: Ammo): string {
    return ammoName(ammo);
  }

  protected devices(): string[] {
    const current = this.form().controls.device.value;
    return [...new Set(['', ...(this.rifle().devices ?? []), current])];
  }

  /** Tapping the selected stance again clears it. */
  protected toggle(control: FormControl<string>, value: string): void {
    control.setValue(control.value === value ? '' : value);
  }
}
