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
  numText,
  parseNum,
  recentPlaces,
  Rifle,
  sessionsOf,
  todayIso,
  zeroInfo,
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
    rezero: new FormControl(false, { nonNullable: true }),
  });

  protected readonly busy = signal(false);
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
    this.form.controls.rifleId.setValue(rifleId);
    if (latest?.place) this.choosePlace(latest.place);
  }

  protected zeroText(rifle: Rifle): string {
    const diary = this.store.diary();
    const zero = zeroInfo(diary, rifle.id);
    if (!zero) return 'ноль не отмечен';
    if (zero.derived) return `ноль ${zero.dist} м, по журналу`;
    return `ноль ${zero.dist} м под ${ammoName(ammoById(diary, zero.ammoId))}`;
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
    if (!rifle || !rifle.combos.length || this.busy()) return;
    this.busy.set(true);
    const v = this.form.getRawValue();
    const zeroDist = zeroInfo(this.store.diary(), rifle.id)?.dist ?? 100;
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
          rezero: v.rezero ? { dist: zeroDist } : null,
          open: true,
          series: [],
        }),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
