import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ammoName,
  calcSetup,
  CalcSetup,
  cardAmmoId,
  cardScopeId,
  DEFAULT_HUMIDITY,
  devName,
  journalVelocity,
  lastWeather,
  numText,
  pressureAtAltitude,
  shortDate,
  STANDARD_ATMOSPHERE,
  todayIso,
  VelocityFit,
  velocitySourceText,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { ViewState } from '../../core/view-state';

export type BallisticsTab = 'card' | 'calc' | 'mpbr';
export type PressureUnit = 'mmHg' | 'hPa' | 'alt';

/** The day the table is calculated for; these never change the records. */
export interface Conditions {
  temp: number;
  /** hPa */
  pressure: number;
  /** m, when the pressure is taken as standard for a height. */
  altitude: number | null;
  /** 0…1 */
  humidity: number;
  /** m/s */
  windSpeed: number;
  windClock: number;
  /** Degrees, uphill positive. */
  lookAngle: number;
  /** Off by default: it matters past 800 m or so. */
  coriolis: { latitude: number; azimuth: number } | null;
}

/** Where the conditions on screen came from. */
export type ConditionsSource = { kind: 'session'; date: string } | { kind: 'standard' | 'manual' };

const STANDARD: Conditions = {
  temp: STANDARD_ATMOSPHERE.temp,
  pressure: STANDARD_ATMOSPHERE.pressure,
  altitude: null,
  humidity: DEFAULT_HUMIDITY,
  windSpeed: 0,
  windClock: 3,
  lookAngle: 0,
  coriolis: null,
};

export const ZONES: readonly number[] = [100, 150, 200];

/** What the three tabs of «Баллистика» share: the combo, the day and the choices on them. */
@Injectable({ providedIn: 'root' })
export class BallisticsState {
  private readonly store = inject(DiaryStore);
  private readonly view = inject(ViewState);
  private readonly settings = inject(SettingsStore);

  readonly tab = signal<BallisticsTab>('card');
  readonly step = signal(100);
  readonly extra = signal(false);
  readonly pressureUnit = signal<PressureUnit>('mmHg');
  /** mm */
  readonly zone = signal(100);
  /** The MPBR row picked by a tap: 'optimal', 'current' or 'near:30'. */
  readonly mpbrRow = signal('optimal');
  /** Null while the conditions follow the latest session. */
  private readonly own = signal<{ value: Conditions; source: ConditionsSource } | null>(null);

  constructor() {
    void this.settings.readSetting<PressureUnit>('pressureUnit').then((unit) => {
      if (unit) this.pressureUnit.set(unit);
    });
  }

  readonly setup = computed((): CalcSetup | null => {
    const rifle = this.view.rifle();
    if (!rifle) return null;
    const diary = this.store.diary();
    const scopeId = cardScopeId(diary, rifle, this.view.scopeId());
    if (!scopeId) return null;
    const card = this.view.card();
    const ammoId = cardAmmoId(diary, rifle, scopeId, this.view.ammoId(), card.device, card.rest);
    return ammoId ? calcSetup(diary, rifle, scopeId, ammoId) : null;
  });

  private readonly fromJournal = computed(() => {
    const setup = this.setup();
    if (!setup) return null;
    const weather = lastWeather(this.store.diary(), setup.rifle.id, setup.ammo?.id);
    if (!weather) return null;
    const { session, atmosphere } = weather;
    return {
      value: {
        ...STANDARD,
        temp: atmosphere.temp,
        pressure: atmosphere.pressure,
        altitude: session.pressure == null && session.altitude != null ? session.altitude : null,
      },
      source: { kind: 'session', date: session.date } as ConditionsSource,
    };
  });

  readonly conditions = computed(
    (): Conditions => this.own()?.value ?? this.fromJournal()?.value ?? STANDARD,
  );

  readonly source = computed(
    (): ConditionsSource =>
      this.own()?.source ?? this.fromJournal()?.source ?? { kind: 'standard' },
  );

  readonly journalDate = computed(() => {
    const source = this.fromJournal()?.source;
    return source?.kind === 'session' ? shortDate(source.date) : null;
  });

  /** The solver's input for the day; null while the ammo lacks a BC or the combo a V₀. */
  readonly input = computed(() => {
    const base = this.setup()?.base;
    if (!base) return null;
    const c = this.conditions();
    return {
      ...base,
      atmosphere: { temp: c.temp, pressure: c.pressure, humidity: c.humidity },
      wind: c.windSpeed ? { speed: c.windSpeed, clock: c.windClock } : null,
      lookAngle: c.lookAngle,
      coriolis: c.coriolis,
    };
  });

  /** «Самосбор 168 · Artelv CRS · ДТК» */
  readonly title = computed(() => {
    const setup = this.setup();
    if (!setup) return '';
    const device = this.view.card().device;
    return [ammoName(setup.ammo), setup.scope?.name, device !== '*' ? devName(device) : '']
      .filter(Boolean)
      .join(' · ');
  });

  /** «V₀ 795 вручную · G7 0,218 · выс. 45 мм» */
  readonly specs = computed(() => {
    const setup = this.setup();
    if (!setup) return '';
    const { v0, ammo } = setup;
    return [
      v0 ? `V₀ ${v0.value} ${velocitySourceText(v0)}` : 'V₀ —',
      ammo?.bc ? `${ammo.dragModel ?? 'G1'} ${numText(ammo.bc)}` : 'БК —',
      `выс. ${numText(setup.sightHeight)} мм`,
    ].join(' · ');
  });

  readonly fit = computed((): VelocityFit | null => {
    const setup = this.setup();
    return setup ? journalVelocity(this.store.diary(), setup, this.view.card().device) : null;
  });

  update(change: Partial<Conditions>): void {
    const value = { ...this.conditions(), ...change };
    if (change.altitude != null) value.pressure = pressureAtAltitude(change.altitude);
    else if (change.pressure != null) value.altitude = null;
    this.own.set({ value, source: { kind: 'manual' } });
  }

  useJournal(): void {
    this.own.set(null);
  }

  useStandard(): void {
    const { windSpeed, windClock, lookAngle, coriolis } = this.conditions();
    this.own.set({
      value: { ...STANDARD, windSpeed, windClock, lookAngle, coriolis },
      source: { kind: 'standard' },
    });
  }

  async setPressureUnit(unit: PressureUnit): Promise<void> {
    this.pressureUnit.set(unit);
    await this.settings.writeSetting('pressureUnit', unit);
  }

  /** Saves a V₀ fitted from the journal into the combo, with its date. */
  async saveFittedVelocity(v0: number): Promise<void> {
    const setup = this.setup();
    if (!setup?.ammo) return;
    const ammoId = setup.ammo.id;
    const rifle = setup.rifle;
    await this.store.save('rifle', {
      ...rifle,
      combos: rifle.combos.map((c) =>
        c.ammoId === ammoId
          ? {
              ...c,
              velocity: Math.round(v0),
              velocitySource: 'journal' as const,
              velocityDate: todayIso(),
            }
          : c,
      ),
    });
  }
}
