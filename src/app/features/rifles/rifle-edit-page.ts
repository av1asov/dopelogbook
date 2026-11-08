import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  Ammo,
  ammoById,
  ammoName,
  numText,
  parseNum,
  rdate,
  rifleById,
  Rifle,
  sessionsOf,
  Units,
} from '../../core/ballistics';
import { compact } from '../../core/data/legacy';
import { DiaryStore } from '../../core/data/diary-store';

const text = (value = '') => new FormControl(value, { nonNullable: true });

type ComboForm = FormGroup<{ ammoId: FormControl<string>; velocity: FormControl<string> }>;

@Component({
  selector: 'app-rifle-edit-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './rifle-edit-page.html',
  styleUrl: './rifle-edit-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RifleEditPage implements OnInit {
  private readonly store = inject(DiaryStore);
  private readonly router = inject(Router);

  /** Route parameter; absent for a new rifle. */
  readonly id = input<string>();

  protected readonly form = new FormGroup({
    name: text(),
    caliber: text(),
    barrel: text(),
    scope: text(),
    units: new FormControl<Units>('MIL', { nonNullable: true }),
    click: text('0,1'),
    sightHeight: text(),
    notes: text(),
    combos: new FormArray<ComboForm>([]),
  });

  protected readonly devices = signal<string[]>([]);
  protected readonly addingDevice = signal(false);
  protected readonly newDevice = text();
  protected readonly pickingAmmo = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  protected readonly existing = computed(() => rifleById(this.store.diary(), this.id()));

  protected readonly sessionCount = computed(() => {
    const id = this.id();
    return id ? sessionsOf(this.store.diary(), id).length : 0;
  });

  protected readonly zeroHistory = computed(() => {
    const id = this.id();
    if (!id) return [];
    const diary = this.store.diary();
    return sessionsOf(diary, id).flatMap((s) => {
      if (!s.rezero || !(s.rezero.dist > 0)) return [];
      const ammo = ammoName(ammoById(diary, s.rezero.ammoId || s.series[0]?.ammoId));
      return [{ id: s.id, dist: s.rezero.dist, ammo, date: rdate(s.date) }];
    });
  });

  ngOnInit(): void {
    const rifle = this.existing();
    if (!rifle) return;
    this.form.patchValue({
      name: rifle.name,
      caliber: rifle.caliber ?? '',
      barrel: rifle.barrel ?? '',
      scope: rifle.scope ?? '',
      units: rifle.units,
      click: numText(rifle.click),
      sightHeight: numText(rifle.sightHeight),
      notes: rifle.notes ?? '',
    });
    this.devices.set([...(rifle.devices ?? [])]);
    for (const combo of rifle.combos) this.addCombo(combo.ammoId, numText(combo.velocity));
  }

  protected ammoLabel(ammoId: string): string {
    return ammoName(ammoById(this.store.diary(), ammoId));
  }

  protected seriesSessions(ammoId: string): number {
    const id = this.id();
    return id ? sessionsOf(this.store.diary(), id, ammoId).length : 0;
  }

  protected freeAmmo(): Ammo[] {
    const taken = new Set(this.form.controls.combos.controls.map((c) => c.controls.ammoId.value));
    const caliber = this.form.controls.caliber.value;
    return this.store
      .ammo()
      .filter((a) => !taken.has(a.id))
      .sort((a, b) => Number(b.caliber === caliber) - Number(a.caliber === caliber));
  }

  protected ammoName(ammo: Ammo): string {
    return ammoName(ammo);
  }

  protected addCombo(ammoId: string, velocity = ''): void {
    this.form.controls.combos.push(
      new FormGroup({ ammoId: text(ammoId), velocity: text(velocity) }),
    );
    this.pickingAmmo.set(false);
  }

  protected removeCombo(index: number): void {
    this.form.controls.combos.removeAt(index);
  }

  protected commitDevice(): void {
    const name = this.newDevice.value.trim();
    if (name && !this.devices().includes(name)) this.devices.update((list) => [...list, name]);
    this.newDevice.setValue('');
    this.addingDevice.set(false);
  }

  protected removeDevice(name: string): void {
    this.devices.update((list) => list.filter((device) => device !== name));
  }

  protected async submit(): Promise<void> {
    if ((await this.persist()) !== null) await this.router.navigate(['/more/rifles']);
  }

  /** Keeps the rifle, then opens the ammo form; the new ammo is linked on return. */
  protected async createAmmo(): Promise<void> {
    const saved = await this.persist();
    if (saved) await this.router.navigate(['/more/ammo/new'], { queryParams: { rifle: saved.id } });
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id) return;
    await this.store.removeRifle(id);
    await this.router.navigate(['/more/rifles']);
  }

  private async persist(): Promise<Rifle | null> {
    const value = this.form.getRawValue();
    const name = value.name.trim();
    if (!name) {
      this.error.set('Дайте винтовке название, чтобы отличать её в журнале.');
      return null;
    }
    const existing = this.existing();
    return this.store.save(
      'rifle',
      compact({
        id: existing?.id,
        createdAt: existing?.createdAt,
        name,
        caliber: value.caliber.trim(),
        barrel: value.barrel.trim(),
        scope: value.scope.trim(),
        units: value.units,
        click: parseNum(value.click),
        sightHeight: parseNum(value.sightHeight),
        notes: value.notes.trim(),
        devices: this.devices(),
        combos: value.combos.map((c) => ({
          ammoId: c.ammoId,
          velocity: parseNum(c.velocity),
        })),
      }),
    );
  }
}
