import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  clickOf,
  distances,
  fitOffer,
  fmt,
  fmtSigned,
  hpaToMmHg,
  journalPoints,
  numText,
  parseNum,
  solve,
  toUnits,
  unitDigits,
  unitLabel,
  unitsOf,
  velocitySourceText,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { ViewState } from '../../core/view-state';
import { Stepper } from '../../shared/stepper';
import { CardSheet } from '../card/card-sheet';
import { BallisticsEmpty } from './ballistics-empty';
import { BallisticsHead } from './ballistics-head';
import { BallisticsState, PressureUnit } from './ballistics-state';
import { VelocityFitSheet } from './velocity-fit-sheet';
import { clockText, WindClock } from './wind-clock';

/** The table goes this far; past it the solver still works, the screen does not need it. */
const TABLE_RANGE = 1000;
const STEPS = [25, 50, 100];
const UNIT_NAMES: Record<PressureUnit, string> = {
  mmHg: 'мм рт. ст.',
  hPa: 'гПа',
  alt: 'высота, м',
};
const NEXT_UNIT: Record<PressureUnit, PressureUnit> = { mmHg: 'hPa', hPa: 'alt', alt: 'mmHg' };

/** An arrow for the side, never a minus: «↓0,1», «←0,4». */
function arrowed(value: number, digits: number, plus: string, minus: string): string {
  const text = fmt(Math.abs(value), digits);
  if (text === fmt(0, digits)) return text;
  return (value > 0 ? plus : minus) + text;
}

@Component({
  selector: 'app-calc-page',
  imports: [
    BallisticsEmpty,
    BallisticsHead,
    CardSheet,
    RouterLink,
    Stepper,
    VelocityFitSheet,
    WindClock,
  ],
  templateUrl: './calc-page.html',
  styleUrls: ['../range/series-picker.css', './ballistics.css', './calc-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalcPage {
  protected readonly state = inject(BallisticsState);
  protected readonly view = inject(ViewState);
  private readonly store = inject(DiaryStore);

  protected readonly sheetOpen = signal(false);
  protected readonly windOpen = signal(false);
  protected readonly moreOpen = signal(false);
  protected readonly fitOpen = signal(false);
  protected readonly clockText = clockText;
  protected readonly unitNames = UNIT_NAMES;

  constructor() {
    this.state.tab.set('calc');
  }

  protected readonly scope = computed(() => this.state.setup()?.scope ?? null);
  private readonly units = computed(() => unitsOf(this.scope()));
  private readonly digits = computed(() => unitDigits(this.scope()));

  protected readonly unitLabel = computed(() => unitLabel(this.units()));

  protected readonly tempText = computed(() => fmtSigned(this.state.conditions().temp, 0));

  protected readonly pressureText = computed(() => {
    const c = this.state.conditions();
    switch (this.state.pressureUnit()) {
      case 'mmHg':
        return fmt(hpaToMmHg(c.pressure), 0);
      case 'hPa':
        return fmt(c.pressure, 0);
      case 'alt':
        return c.altitude != null ? fmt(c.altitude, 0) : '';
    }
  });

  protected readonly journal = computed(() => {
    const setup = this.state.setup();
    if (!setup?.scope || !setup.ammo) return [];
    const device = this.view.card().device;
    return journalPoints(this.store.diary(), setup.rifle.id, setup.scope.id, setup.ammo.id, device);
  });

  private readonly trajectory = computed(() => {
    const input = this.state.input();
    if (!input) return null;
    const all = solve(input, distances(this.state.step(), TABLE_RANGE));
    const subsonic = all.findIndex((r) => r.mach < 1);
    return {
      rows: subsonic < 0 ? all : all.slice(0, subsonic),
      subsonicAt: subsonic < 0 ? null : all[subsonic].d,
    };
  });

  protected readonly rows = computed(() => {
    const units = this.units();
    const digits = this.digits();
    const click = clickOf(this.scope());
    const known = new Set(this.journal().map((p) => p.d));
    return (this.trajectory()?.rows ?? []).map((r) => {
      const elev = toUnits(r.elev, units);
      const wind = toUnits(r.wind, units);
      const clicks = Math.round(elev / click);
      const drift = r.drift == null ? null : toUnits((-r.drift / 1000 / r.d) * 1000, units);
      return {
        d: r.d,
        logged: known.has(r.d),
        elev: arrowed(elev, digits, '', '↓'),
        clicks: clicks < 0 ? `↓${-clicks}` : String(clicks),
        wind: arrowed(wind, digits, '→', '←'),
        v: fmt(r.v, 0),
        transonic: r.mach < 1.2,
        energy: r.energy == null ? '—' : fmt(r.energy, 0),
        time: fmt(r.time, 2),
        drift: drift == null ? '—' : arrowed(drift, digits, '→', '←'),
      };
    });
  });

  protected readonly subsonicAt = computed(() => this.trajectory()?.subsonicAt ?? null);
  protected readonly transonic = computed(() => this.rows().some((r) => r.transonic));

  /** «на 200 м там 0,8»: where the journal is a click or more off the calculation. */
  protected readonly differences = computed(() => {
    const rows = this.trajectory()?.rows ?? [];
    const units = this.units();
    const click = clickOf(this.scope());
    return this.journal()
      .flatMap((p) => {
        const row = rows.find((r) => r.d === p.d);
        if (!row) return [];
        const calc = toUnits(row.elev, units);
        const logged = toUnits(p.elev, units);
        return Math.abs(calc - logged) >= click - 1e-9
          ? [`на ${p.d} м там ${fmt(logged, this.digits())}`]
          : [];
      })
      .slice(0, 3);
  });

  protected readonly offer = computed(() =>
    fitOffer(this.state.setup()?.v0 ?? null, this.state.fit()),
  );

  protected readonly offerText = computed(() => {
    const fit = this.state.fit();
    const v0 = this.state.setup()?.v0;
    if (!fit) return '';
    const current =
      v0?.source === 'estimate'
        ? `оценка ${v0.value}`
        : v0
          ? `${v0.value} ${velocitySourceText(v0)}`
          : '';
    const now = current ? ` (сейчас: ${current})` : '';
    return `По журналу ${fmt(fit.v0, 0)} ± ${fmt(fit.error, 0)} м/с${now}`;
  });

  protected readonly sourceLabel = computed(() => {
    const source = this.state.source();
    const date = this.state.journalDate();
    if (source.kind === 'session') return { text: `Из стрельбы ${date}`, link: false };
    if (date) return { text: `Из стрельбы ${date}`, link: true };
    return null;
  });

  protected readonly notes = computed(() => {
    const setup = this.state.setup();
    if (!setup) return [];
    const notes: string[] = [];
    if (!setup.zero) notes.push(`Ноль прицела не отмечен — считаю от ${setup.zeroDist} м.`);
    if (setup.sightAssumed) {
      notes.push(
        `Высота прицела не задана — взято ${setup.sightHeight} мм. Укажите её в установке прицела на винтовке.`,
      );
    }
    return notes;
  });

  protected bump(field: 'temp' | 'windSpeed', delta: number): void {
    const value = this.state.conditions()[field] + delta;
    this.state.update({ [field]: field === 'windSpeed' ? Math.max(0, value) : value });
  }

  protected setPressure(event: Event): void {
    const value = parseNum((event.target as HTMLInputElement).value);
    if (value == null) return;
    switch (this.state.pressureUnit()) {
      case 'mmHg':
        if (value > 400 && value < 900) this.state.update({ pressure: value * 1.333224 });
        break;
      case 'hPa':
        if (value > 500 && value < 1200) this.state.update({ pressure: value });
        break;
      case 'alt':
        if (value > -500 && value < 6000) this.state.update({ altitude: value });
        break;
    }
  }

  protected nextPressureUnit(): void {
    void this.state.setPressureUnit(NEXT_UNIT[this.state.pressureUnit()]);
  }

  protected nextStep(): void {
    const i = STEPS.indexOf(this.state.step());
    this.state.step.set(STEPS[(i + 1) % STEPS.length]);
  }

  protected humidityText(): string {
    return `${Math.round(this.state.conditions().humidity * 100)} %`;
  }

  protected bumpHumidity(delta: number): void {
    const value = Math.round(this.state.conditions().humidity * 100) + delta * 5;
    this.state.update({ humidity: Math.min(100, Math.max(0, value)) / 100 });
  }

  protected bumpLook(delta: number): void {
    const value = this.state.conditions().lookAngle + delta;
    this.state.update({ lookAngle: Math.min(60, Math.max(-60, value)) });
  }

  protected toggleCoriolis(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.state.update({ coriolis: on ? { latitude: 55, azimuth: 0 } : null });
  }

  protected setCoriolis(field: 'latitude' | 'azimuth', event: Event): void {
    const value = parseNum((event.target as HTMLInputElement).value);
    const current = this.state.conditions().coriolis;
    if (value == null || !current) return;
    this.state.update({ coriolis: { ...current, [field]: value } });
  }

  protected readonly numText = numText;

  protected fmtAngle(degrees: number): string {
    return `${degrees ? fmtSigned(degrees, 0) : '0'}°`;
  }

  protected async acceptFit(): Promise<void> {
    const fit = this.state.fit();
    if (fit) await this.state.saveFittedVelocity(fit.v0);
  }
}
