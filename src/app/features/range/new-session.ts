import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import {
  altitudeAt,
  ammoById,
  ammoName,
  mainScope,
  mountsOf,
  numText,
  parseNum,
  recentPlaces,
  Rifle,
  scopeById,
  sessionsOf,
  todayIso,
  zeroingDefaults,
  zeroText,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { compact } from '../../core/data/legacy';
import { SignedInput } from '../../shared/signed-input';

const text = (value = '') => new FormControl(value, { nonNullable: true });

@Component({
  selector: 'app-new-session',
  imports: [ReactiveFormsModule, RouterLink, SignedInput],
  templateUrl: './new-session.html',
  styleUrl: './new-session.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewSession implements OnInit {
  protected readonly store = inject(DiaryStore);

  protected readonly form = new FormGroup({
    rifleId: text(),
    date: text(todayIso()),
    place: text(),
    temp: text(),
    pressure: text(),
    altitude: text(),
    zeroingOn: new FormControl(false, { nonNullable: true }),
    zeroDist: text('100'),
    zeroAmmo: text(),
    zeroScope: text(),
  });

  protected readonly busy = signal(false);
  protected readonly editingZero = signal(false);
  private readonly rifleId = toSignal(
    this.form.controls.rifleId.valueChanges.pipe(map(() => this.form.controls.rifleId.value)),
    { initialValue: '' },
  );
  private readonly place = toSignal(this.form.controls.place.valueChanges, { initialValue: '' });

  protected readonly places = computed(() => recentPlaces(this.store.diary()));
  protected readonly currentPlace = computed(() => this.place());
  protected readonly rifle = computed(() =>
    this.store.rifles().find((r) => r.id === this.rifleId()),
  );

  ngOnInit(): void {
    const diary = this.store.diary();
    const latest = sessionsOf(diary)[0];
    const rifles = this.store.rifles();
    const rifleId = rifles.some((r) => r.id === latest?.rifleId) ? latest.rifleId : rifles[0].id;
    this.form.controls.rifleId.valueChanges.subscribe(() => this.fillZeroing());
    this.form.controls.rifleId.setValue(rifleId);
    if (latest?.place) this.choosePlace(latest.place);
  }

  protected zeroText(rifle: Rifle): string {
    const diary = this.store.diary();
    const scope = mainScope(diary, rifle);
    if (!scope) return 'прицел не добавлен';
    return `${scope.name} · ${zeroText(diary, rifle.id, scope.id, false)}`;
  }

  protected hasScope(rifle: Rifle | undefined): boolean {
    return mountsOf(this.store.diary(), rifle).length > 0;
  }

  protected scopeOptions(rifle: Rifle): { id: string; name: string }[] {
    return mountsOf(this.store.diary(), rifle).map(({ scope }) => scope);
  }

  protected ammoOptions(rifle: Rifle): { id: string; name: string }[] {
    const diary = this.store.diary();
    return rifle.combos.map((c) => ({ id: c.ammoId, name: ammoName(ammoById(diary, c.ammoId)) }));
  }

  protected zeroAmmoName(): string {
    return ammoName(ammoById(this.store.diary(), this.form.controls.zeroAmmo.value));
  }

  protected zeroScopeName(): string {
    return scopeById(this.store.diary(), this.form.controls.zeroScope.value)?.name ?? '';
  }

  private fillZeroing(): void {
    const rifle = this.rifle();
    if (!rifle) return;
    const plan = zeroingDefaults(this.store.diary(), rifle);
    this.form.patchValue({
      zeroDist: numText(plan.dist),
      zeroAmmo: plan.ammoId,
      zeroScope: plan.scopeId,
    });
  }

  protected choosePlace(place: string): void {
    this.form.controls.place.setValue(place);
    this.fillAltitude();
  }

  protected fillAltitude(): void {
    const altitude = altitudeAt(this.store.diary(), this.form.controls.place.value.trim());
    if (altitude != null) this.form.controls.altitude.setValue(numText(altitude));
  }

  protected async start(): Promise<void> {
    const rifle = this.rifle();
    if (!rifle || !rifle.combos.length || !this.hasScope(rifle) || this.busy()) return;
    this.busy.set(true);
    const v = this.form.getRawValue();
    const zeroing = v.zeroingOn
      ? { dist: parseNum(v.zeroDist) ?? 100, ammoId: v.zeroAmmo, scopeId: v.zeroScope }
      : null;
    try {
      await this.store.save(
        'session',
        compact({
          rifleId: rifle.id,
          date: v.date || todayIso(),
          place: v.place.trim(),
          temp: parseNum(v.temp),
          pressure: parseNum(v.pressure),
          altitude: parseNum(v.altitude),
          zeroing,
          open: true,
          series: [],
        }),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
