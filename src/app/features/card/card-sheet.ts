import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  ammoById,
  ammoName,
  CardData,
  combosOf,
  devicesUsed,
  devName,
  mountsOf,
  numText,
  parseNum,
  restName,
  restsUsed,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { ViewState } from '../../core/view-state';

const text = (value = '') => new FormControl(value, { nonNullable: true });

@Component({
  selector: 'app-card-sheet',
  imports: [ReactiveFormsModule],
  templateUrl: './card-sheet.html',
  styleUrls: ['../range/series-picker.css', './card-sheet.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSheet implements OnInit {
  protected readonly store = inject(DiaryStore);
  protected readonly view = inject(ViewState);
  private readonly destroyRef = inject(DestroyRef);

  readonly data = input.required<CardData>();
  readonly closed = output<void>();

  protected readonly steps = [25, 50, 100];
  protected readonly range = new FormGroup({ from: text(), to: text() });
  protected readonly devName = devName;

  protected readonly ammoList = computed(() => {
    const diary = this.store.diary();
    return combosOf(diary, this.data().rifle).flatMap((combo) => {
      const ammo = ammoById(diary, combo.ammoId);
      return ammo
        ? [{ id: ammo.id, name: ammoName(ammo), handload: ammo.type === 'handload' }]
        : [];
    });
  });

  protected readonly scopes = computed(() =>
    mountsOf(this.store.diary(), this.data().rifle).map(({ scope }) => scope),
  );

  protected readonly devices = computed(() => {
    const { rifle, ammo, scope } = this.data();
    const used = devicesUsed(this.store.diary(), rifle.id, ammo?.id, scope?.id);
    return [...new Set(['', ...(rifle.devices ?? []), ...used])];
  });

  protected readonly rests = computed(() => {
    const { rifle, ammo, scope } = this.data();
    return restsUsed(this.store.diary(), rifle.id, ammo?.id, scope?.id).map((value) => ({
      value,
      name: restName(value) || 'не указана',
    }));
  });

  ngOnInit(): void {
    const { from, to } = this.view.card();
    this.range.setValue({ from: numText(from), to: numText(to) });
    this.range.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.view.updateCard({ from: parseNum(value.from), to: parseNum(value.to) });
    });
  }

  protected selectAmmo(id: string): void {
    this.view.ammoId.set(id);
    this.view.updateCard({ device: '*', rest: '*' });
  }

  protected selectScope(id: string): void {
    this.view.scopeId.set(id);
    this.view.updateCard({ device: '*', rest: '*' });
  }

  protected toggleWind(event: Event): void {
    this.view.updateCard({ wind: (event.target as HTMLInputElement).checked });
  }
}
