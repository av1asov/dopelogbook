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
  barrelOf,
  calcSetup,
  comboVelocity,
  journalVelocity,
  mainScope,
  numText,
  parseNum,
  rifleById,
  Rifle,
  Scope,
  scopeById,
  sessionsOf,
  todayIso,
  V0Info,
  VelocityFit,
  VelocitySource,
  velocitySourceText,
  zeroInfo,
} from '../../core/ballistics';
import { compact } from '../../core/data/legacy';
import { DiaryStore } from '../../core/data/diary-store';
import { VelocityFitSheet } from '../ballistics/velocity-fit-sheet';

const text = (value = '') => new FormControl(value, { nonNullable: true });

type ComboForm = FormGroup<{
  ammoId: FormControl<string>;
  velocity: FormControl<string>;
  /** How the saved speed was obtained; typing a new one makes it manual. */
  source: FormControl<VelocitySource | ''>;
  date: FormControl<string>;
  /** The speed as it was saved, to tell whether it was retyped. */
  saved: FormControl<string>;
}>;

/** «10» → right-hand 1:10″; «10 L» → left-hand. */
function parseTwist(text: string): { twist: number | null; dir: 'R' | 'L' } {
  const left = /[lл]/i.test(text);
  return { twist: parseNum(text.replace(/[^\d.,]/g, '')), dir: left ? 'L' : 'R' };
}
type MountForm = FormGroup<{
  scopeId: FormControl<string>;
  sightHeight: FormControl<string>;
  mounted: FormControl<boolean>;
}>;

@Component({
  selector: 'app-rifle-edit-page',
  imports: [ReactiveFormsModule, RouterLink, VelocityFitSheet],
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
    barrelLength: text(),
    twist: text(),
    notes: text(),
    mounts: new FormArray<MountForm>([]),
    combos: new FormArray<ComboForm>([]),
  });

  protected readonly devices = signal<string[]>([]);
  protected readonly addingDevice = signal(false);
  protected readonly newDevice = text();
  protected readonly pickingAmmo = signal(false);
  protected readonly pickingScope = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);
  /** The combo whose journal fit is open. */
  protected readonly fitFor = signal<string | null>(null);
  protected readonly round = Math.round;

  /** V₀ fitted from the journal for each combo of a saved rifle, by ammo id. */
  protected readonly fits = computed((): Record<string, VelocityFit> => {
    const rifle = this.existing();
    if (!rifle) return {};
    const diary = this.store.diary();
    const scope = mainScope(diary, rifle);
    const out: Record<string, VelocityFit> = {};
    for (const combo of rifle.combos) {
      const fit = journalVelocity(diary, calcSetup(diary, rifle, scope?.id, combo.ammoId));
      if (fit && isFinite(fit.error)) out[combo.ammoId] = fit;
    }
    return out;
  });

  /** «≈738» for combos without a speed, from the box and the barrel length. */
  protected readonly estimates = computed((): Record<string, string> => {
    const rifle = this.existing();
    const diary = this.store.diary();
    const out: Record<string, string> = {};
    for (const combo of rifle?.combos ?? []) {
      const ammo = ammoById(diary, combo.ammoId);
      const estimate = comboVelocity(rifle, ammo, { ammoId: combo.ammoId });
      if (estimate) out[combo.ammoId] = `≈${estimate.value}`;
    }
    return out;
  });

  protected readonly existing = computed(() => rifleById(this.store.diary(), this.id()));

  protected readonly sessionCount = computed(() => {
    const id = this.id();
    return id ? sessionsOf(this.store.diary(), id).length : 0;
  });

  ngOnInit(): void {
    const rifle = this.existing();
    if (!rifle) return;
    const barrel = barrelOf(rifle);
    this.form.patchValue({
      name: rifle.name,
      caliber: rifle.caliber ?? '',
      barrelLength: numText(barrel.length),
      twist: barrel.twist ? `${numText(barrel.twist)}${barrel.dir === 'L' ? ' L' : ''}` : '',
      notes: rifle.notes ?? '',
    });
    this.devices.set([...(rifle.devices ?? [])]);
    for (const combo of rifle.combos) {
      this.addCombo(
        combo.ammoId,
        numText(combo.velocity),
        combo.velocitySource,
        combo.velocityDate,
      );
    }
    for (const mount of rifle.mounts) {
      this.pushMount(mount.scopeId, numText(mount.sightHeight), mount.mounted);
    }
  }

  protected scopeName(scopeId: string): string {
    return scopeById(this.store.diary(), scopeId)?.name ?? '—';
  }

  protected mountStatus(mount: MountForm): string {
    const zero = this.id()
      ? zeroInfo(this.store.diary(), this.id() as string, mount.controls.scopeId.value)
      : null;
    return [
      mount.controls.mounted.value ? 'установлен' : 'снят',
      zero ? `ноль ${zero.dist} м` : 'ноль не отмечен',
    ].join(' · ');
  }

  /** A scope that has series on this rifle cannot be taken off the list. */
  protected scopeSessions(scopeId: string): number {
    const id = this.id();
    if (!id) return 0;
    return sessionsOf(this.store.diary(), id).filter((s) =>
      s.series.some((x) => x.scopeId === scopeId),
    ).length;
  }

  protected freeScopes(): Scope[] {
    const taken = new Set(this.form.controls.mounts.controls.map((m) => m.controls.scopeId.value));
    return this.store.scopes().filter((scope) => !taken.has(scope.id));
  }

  protected addScope(scopeId: string): void {
    const anyMounted = this.form.controls.mounts.controls.some((m) => m.controls.mounted.value);
    this.pushMount(scopeId, '', !anyMounted);
    this.pickingScope.set(false);
  }

  /** Mounting one scope takes off the one that was there. */
  protected install(index: number): void {
    this.form.controls.mounts.controls.forEach((mount, i) =>
      mount.controls.mounted.setValue(i === index),
    );
  }

  protected removeMount(index: number): void {
    this.form.controls.mounts.removeAt(index);
  }

  private pushMount(scopeId: string, sightHeight: string, mounted: boolean): void {
    this.form.controls.mounts.push(
      new FormGroup({
        scopeId: text(scopeId),
        sightHeight: text(sightHeight),
        mounted: new FormControl(mounted, { nonNullable: true }),
      }),
    );
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

  protected addCombo(
    ammoId: string,
    velocity = '',
    source: VelocitySource | '' = '',
    date = '',
  ): void {
    this.form.controls.combos.push(
      new FormGroup({
        ammoId: text(ammoId),
        velocity: text(velocity),
        source: new FormControl<VelocitySource | ''>(velocity ? source || 'manual' : '', {
          nonNullable: true,
        }),
        date: text(date),
        saved: text(velocity),
      }),
    );
    this.pickingAmmo.set(false);
  }

  /** «по журналу, 16.11» under the ammo while the speed is the saved one. */
  protected velocityNote(combo: ComboForm): string {
    const { velocity, saved, source, date } = combo.getRawValue();
    if (!velocity.trim())
      return this.estimates()[combo.controls.ammoId.value] ? 'оценка с пачки' : '';
    if (velocity !== saved || !source) return 'вручную';
    return velocitySourceText({ value: 0, source, ...(date ? { date } : {}) });
  }

  protected currentV0(ammoId: string): V0Info | null {
    const combo = this.form.controls.combos.controls.find(
      (c) => c.controls.ammoId.value === ammoId,
    );
    const value = parseNum(combo?.controls.velocity.value);
    if (!combo || !value) return null;
    const { velocity, saved, source, date } = combo.getRawValue();
    const kept = velocity === saved && source ? source : 'manual';
    return { value, source: kept, ...(date ? { date } : {}) };
  }

  /** Puts the fitted speed into the form; «Готово» saves it. */
  protected applyFit(ammoId: string, v0: number): void {
    const combo = this.form.controls.combos.controls.find(
      (c) => c.controls.ammoId.value === ammoId,
    );
    const value = String(Math.round(v0));
    combo?.setValue({ ammoId, velocity: value, source: 'journal', date: todayIso(), saved: value });
    this.fitFor.set(null);
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

  /** Keeps the rifle, then opens the scope form; the new scope is mounted on return. */
  protected async createScope(): Promise<void> {
    const saved = await this.persist();
    if (saved) {
      await this.router.navigate(['/more/scopes/new'], { queryParams: { rifle: saved.id } });
    }
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
    const twist = parseTwist(value.twist);
    return this.store.save(
      'rifle',
      compact({
        id: existing?.id,
        createdAt: existing?.createdAt,
        name,
        caliber: value.caliber.trim(),
        barrel: existing?.barrel,
        barrelLength: parseNum(value.barrelLength),
        twist: twist.twist,
        twistDir: twist.twist && twist.dir === 'L' ? 'L' : undefined,
        notes: value.notes.trim(),
        devices: this.devices(),
        combos: value.combos.map((c) => {
          const velocity = parseNum(c.velocity);
          if (!velocity) return { ammoId: c.ammoId, velocity: null };
          const kept = c.velocity === c.saved && c.source ? c.source : null;
          return compact({
            ammoId: c.ammoId,
            velocity,
            velocitySource: kept ?? ('manual' as const),
            velocityDate: kept && c.date ? c.date : undefined,
          });
        }),
        mounts: value.mounts.map((m) =>
          compact({
            scopeId: m.scopeId,
            sightHeight: parseNum(m.sightHeight),
            mounted: m.mounted,
          }),
        ),
      }),
    );
  }
}
