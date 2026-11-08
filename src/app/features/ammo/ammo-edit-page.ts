import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  Ammo,
  ammoById,
  ammoName,
  numText,
  parseNum,
  plural,
  rifleById,
  sessionsOf,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { compact } from '../../core/data/legacy';

const text = (value = '') => new FormControl(value, { nonNullable: true });
const RECIPE_FIELDS = [
  'bullet',
  'powder',
  'charge',
  'chargeUnit',
  'brass',
  'primer',
  'coal',
] as const;

@Component({
  selector: 'app-ammo-edit-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './ammo-edit-page.html',
  styleUrl: './ammo-edit-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AmmoEditPage implements OnInit {
  private readonly store = inject(DiaryStore);
  private readonly router = inject(Router);

  /** Route parameter; absent for new ammo. */
  readonly id = input<string>();
  /** Query parameter: the ammo to copy into a new lot or variant. */
  readonly from = input<string>();
  /** Query parameter: the rifle to link the new ammo to. */
  readonly rifle = input<string>();

  protected readonly form = new FormGroup({
    type: new FormControl<Ammo['type']>('factory', { nonNullable: true }),
    name: text(),
    caliber: text(),
    notes: text(),
    bullet: text(),
    maker: text(),
    line: text(),
    lot: text(),
    powder: text(),
    charge: text(),
    chargeUnit: new FormControl<'gr' | 'г'>('gr', { nonNullable: true }),
    brass: text(),
    primer: text(),
    coal: text(),
  });

  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  private readonly original = signal<ReturnType<typeof this.form.getRawValue> | null>(null);
  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly type = computed(() => this.value().type);
  protected readonly existing = computed(() => ammoById(this.store.diary(), this.id()));

  protected readonly sessionCount = computed(() => {
    const id = this.id();
    return id ? sessionsOf(this.store.diary(), null, id).length : 0;
  });

  protected readonly seriesCount = computed(() => {
    const id = this.id();
    if (!id) return 0;
    return sessionsOf(this.store.diary(), null, id).flatMap((s) =>
      s.series.filter((x) => x.ammoId === id),
    ).length;
  });

  protected readonly seriesText = computed(() => {
    const n = this.seriesCount();
    return `${n} ${plural(n, 'серия', 'серии', 'серий')}`;
  });

  /** Recipe edits on used ammo would rewrite history, so a variant is offered. */
  protected readonly offerVariant = computed(() => {
    const original = this.original();
    const current = this.value();
    return (
      !!original &&
      this.seriesCount() > 0 &&
      current.type === 'handload' &&
      RECIPE_FIELDS.some((field) => current[field] !== original[field])
    );
  });

  ngOnInit(): void {
    const diary = this.store.diary();
    const source = ammoById(diary, this.id() ?? this.from());
    if (!source) {
      const rifle = rifleById(diary, this.rifle());
      if (rifle?.caliber) this.form.controls.caliber.setValue(rifle.caliber);
      return;
    }
    const copying = !this.id();
    const handload = source.type === 'handload';
    this.form.patchValue({
      type: source.type,
      name:
        copying && handload ? `${source.name || ammoName(source)} (вариант)` : (source.name ?? ''),
      caliber: source.caliber ?? '',
      notes: source.notes ?? '',
      bullet: source.bullet ?? '',
      maker: source.maker ?? '',
      line: source.line ?? '',
      lot: copying ? '' : (source.lot ?? ''),
      powder: source.powder ?? '',
      charge: numText(source.charge),
      chargeUnit: source.chargeUnit ?? 'gr',
      brass: source.brass ?? '',
      primer: source.primer ?? '',
      coal: numText(source.coal),
    });
    if (!copying) this.original.set(this.form.getRawValue());
  }

  protected toggleChargeUnit(): void {
    const { chargeUnit } = this.form.controls;
    chargeUnit.setValue(chargeUnit.value === 'gr' ? 'г' : 'gr');
  }

  protected async submit(): Promise<void> {
    const existing = this.existing();
    await this.persist({ id: existing?.id, createdAt: existing?.createdAt });
  }

  protected async saveAsVariant(): Promise<void> {
    const name = this.form.controls.name;
    if (name.value.trim() === this.original()?.name.trim())
      name.setValue(`${name.value} (вариант)`);
    await this.persist({});
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id || this.sessionCount()) return;
    await this.store.removeAmmo(id);
    await this.router.navigate(['/more/ammo']);
  }

  private async persist(meta: { id?: string; createdAt?: string }): Promise<void> {
    const v = this.form.getRawValue();
    const handload = v.type === 'handload';
    const fields = {
      type: v.type,
      name: v.name.trim(),
      caliber: v.caliber.trim(),
      notes: v.notes.trim(),
      bullet: v.bullet.trim(),
      ...(handload
        ? {
            powder: v.powder.trim(),
            charge: parseNum(v.charge),
            chargeUnit: v.chargeUnit,
            brass: v.brass.trim(),
            primer: v.primer.trim(),
            coal: parseNum(v.coal),
          }
        : { maker: v.maker.trim(), line: v.line.trim(), lot: v.lot.trim() }),
    };
    if (
      !fields.name &&
      !fields.bullet &&
      !('maker' in fields && (fields.maker || fields.line)) &&
      !('powder' in fields && fields.powder)
    ) {
      this.error.set(
        'Заполните хотя бы название, производителя или пулю, чтобы патрон можно было узнать в списке.',
      );
      return;
    }
    const saved = await this.store.save('ammo', compact({ ...meta, ...fields }));
    await this.afterSave(saved.id);
  }

  private async afterSave(ammoId: string): Promise<void> {
    const rifle = rifleById(this.store.diary(), this.rifle());
    if (!rifle) {
      await this.router.navigate(['/more/ammo']);
      return;
    }
    if (!rifle.combos.some((c) => c.ammoId === ammoId)) {
      await this.store.save('rifle', { ...rifle, combos: [...rifle.combos, { ammoId }] });
    }
    await this.router.navigate(['/more/rifles', rifle.id]);
  }
}
