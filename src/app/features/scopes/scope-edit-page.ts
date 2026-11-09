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
  defaultClick,
  Mount,
  numText,
  parseNum,
  Rifle,
  rifleById,
  SCOPE_TYPES,
  SCOPE_UNITS,
  scopeById,
  ScopeType,
  ScopeUnits,
  unitShort,
  zeroInfo,
  shortDate,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { compact } from '../../core/data/legacy';

const text = (value = '') => new FormControl(value, { nonNullable: true });

type MountForm = FormGroup<{
  rifleId: FormControl<string>;
  sightHeight: FormControl<string>;
  mounted: FormControl<boolean>;
}>;

@Component({
  selector: 'app-scope-edit-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './scope-edit-page.html',
  styleUrl: './scope-edit-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopeEditPage implements OnInit {
  private readonly store = inject(DiaryStore);
  private readonly router = inject(Router);

  /** Route parameter; absent for a new scope. */
  readonly id = input<string>();
  /** Query parameter: the rifle to mount a new scope on and return to. */
  readonly rifle = input<string>();

  protected readonly types = SCOPE_TYPES;
  protected readonly unitOptions = SCOPE_UNITS;

  protected readonly form = new FormGroup({
    type: new FormControl<ScopeType>('optic', { nonNullable: true }),
    name: text(),
    units: new FormControl<ScopeUnits>('MRAD', { nonNullable: true }),
    click: text('0,1'),
    magnification: text(),
    notes: text(),
    mounts: new FormArray<MountForm>([]),
  });

  protected readonly pickingRifle = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly existing = computed(() => scopeById(this.store.diary(), this.id()));

  /** A scope with recorded series cannot be deleted, like ammo. */
  protected readonly seriesCount = computed(
    () =>
      this.store
        .diary()
        .sessions.flatMap((s) => s.series)
        .filter((x) => x.scopeId === this.id()).length,
  );

  protected readonly returnLink = computed(() =>
    this.rifle() ? ['/more/rifles', this.rifle()] : ['/more/scopes'],
  );

  ngOnInit(): void {
    const scope = this.existing();
    if (scope) {
      this.form.patchValue({
        type: scope.type,
        name: scope.name,
        units: scope.units,
        click: numText(scope.click),
        magnification: scope.magnification ?? '',
        notes: scope.notes ?? '',
      });
      for (const rifle of this.store.rifles()) {
        const mount = rifle.mounts.find((m) => m.scopeId === scope.id);
        if (mount) this.pushMount(rifle.id, numText(mount.sightHeight), mount.mounted);
      }
      return;
    }
    const target = rifleById(this.store.diary(), this.rifle());
    if (target) this.addRifle(target);
  }

  protected selectUnits(units: ScopeUnits): void {
    const { units: control, click } = this.form.controls;
    control.setValue(units);
    if (!click.dirty) click.setValue(numText(defaultClick(units)));
  }

  protected clickLabel(): string {
    const units = this.form.controls.units.value;
    if (units === 'CM100') return 'см';
    if (units === 'MM100') return 'мм';
    return unitShort(units);
  }

  protected rifleName(rifleId: string): string {
    return rifleById(this.store.diary(), rifleId)?.name ?? '—';
  }

  protected mountStatus(mount: MountForm): string {
    const id = this.id();
    const zero = id ? zeroInfo(this.store.diary(), mount.controls.rifleId.value, id) : null;
    if (!zero) return 'ноль не отмечен';
    return `ноль ${zero.dist} м${zero.date ? ` · ${shortDate(zero.date)}` : ''}`;
  }

  /** A rifle that fired series through this scope stays on the list. */
  protected rifleSeries(rifleId: string): number {
    return this.store
      .diary()
      .sessions.filter((s) => s.rifleId === rifleId)
      .flatMap((s) => s.series)
      .filter((x) => x.scopeId === this.id()).length;
  }

  protected freeRifles(): Rifle[] {
    const taken = new Set(this.form.controls.mounts.controls.map((m) => m.controls.rifleId.value));
    return this.store.rifles().filter((rifle) => !taken.has(rifle.id));
  }

  /** On a rifle that has no mounted scope the new one goes straight on. */
  protected addRifle(rifle: Rifle): void {
    this.pushMount(rifle.id, '', !rifle.mounts.some((m) => m.mounted));
    this.pickingRifle.set(false);
  }

  protected toggleMounted(mount: MountForm): void {
    const { mounted } = mount.controls;
    mounted.setValue(!mounted.value);
  }

  protected removeMount(index: number): void {
    this.form.controls.mounts.removeAt(index);
  }

  protected async submit(): Promise<void> {
    const value = this.form.getRawValue();
    const name = value.name.trim();
    if (!name) {
      this.error.set('Дайте прицелу название, чтобы отличать его в журнале.');
      return;
    }
    const existing = this.existing();
    const saved = await this.store.save(
      'scope',
      compact({
        id: existing?.id,
        createdAt: existing?.createdAt,
        name,
        type: value.type,
        units: value.units,
        click: parseNum(value.click),
        magnification: value.magnification.trim(),
        notes: value.notes.trim(),
      }),
    );
    await this.saveMounts(saved.id);
    await this.router.navigate(this.returnLink());
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id || this.seriesCount()) return;
    await this.store.removeScope(id);
    await this.router.navigate(['/more/scopes']);
  }

  private pushMount(rifleId: string, sightHeight: string, mounted: boolean): void {
    this.form.controls.mounts.push(
      new FormGroup({
        rifleId: text(rifleId),
        sightHeight: text(sightHeight),
        mounted: new FormControl(mounted, { nonNullable: true }),
      }),
    );
  }

  /** Mounting takes the previous scope off that rifle. */
  private async saveMounts(scopeId: string): Promise<void> {
    const wanted = new Map(
      this.form.controls.mounts.getRawValue().map((m) => [m.rifleId, m] as const),
    );
    for (const rifle of this.store.rifles()) {
      const row = wanted.get(rifle.id);
      const others = rifle.mounts.filter((m) => m.scopeId !== scopeId);
      const mine: Mount[] = row
        ? [compact({ scopeId, sightHeight: parseNum(row.sightHeight), mounted: row.mounted })]
        : [];
      const kept = row?.mounted ? others.map((m) => ({ ...m, mounted: false })) : others;
      const mounts = [...kept, ...mine];
      if (JSON.stringify(mounts) === JSON.stringify(rifle.mounts)) continue;
      await this.store.save('rifle', { ...rifle, mounts });
    }
  }
}
