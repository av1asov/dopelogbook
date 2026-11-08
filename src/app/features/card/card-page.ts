import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ammoName,
  cardAmmoId,
  cardRows,
  combosOf,
  devicesUsed,
  devName,
  fmt,
  fmtAng,
  fmtSigned,
  groupStats,
  numText,
  restName,
  restShift,
  zeroNotes,
} from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { saveFile } from '../../core/save-file';
import { ViewState } from '../../core/view-state';
import { cardFileName, CardExportOptions, cardText, renderCardPng } from './card-export';
import { CardSheet } from './card-sheet';

@Component({
  selector: 'app-card-page',
  imports: [CardSheet, RouterLink],
  templateUrl: './card-page.html',
  styleUrl: './card-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardPage {
  protected readonly store = inject(DiaryStore);
  protected readonly view = inject(ViewState);
  private readonly settings = inject(SettingsStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly sheetOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly pngUrl = signal<string | null>(null);

  protected readonly hasCombos = computed(
    () => combosOf(this.store.diary(), this.view.rifle()).length > 0,
  );

  protected readonly data = computed(() => {
    const rifle = this.view.rifle();
    if (!rifle) return null;
    const diary = this.store.diary();
    const card = this.view.card();
    const ammoId = cardAmmoId(diary, rifle, this.view.ammoId(), card.device, card.rest);
    return ammoId ? cardRows(diary, rifle, ammoId, card) : null;
  });

  protected readonly title = computed(() => {
    const data = this.data();
    const card = this.view.card();
    if (!data) return '';
    const parts = [ammoName(data.ammo)];
    if (card.device !== '*') parts.push(devName(card.device));
    if (card.rest !== '*') parts.push(restName(card.rest) || 'опора не указана');
    return parts.join(' · ');
  });

  protected readonly specs = computed(() => {
    const data = this.data();
    if (!data) return '';
    const { rifle, points } = data;
    return [
      points.zero ? `ноль ${points.zero.dist} м` : 'ноль не отмечен',
      rifle.units,
      rifle.click != null ? `щелчок ${numText(rifle.click)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  protected readonly showWind = computed(() => {
    const data = this.data();
    return !!data && this.view.card().wind && data.points.wind.length > 0;
  });

  protected readonly rows = computed(() =>
    (this.data()?.rows ?? []).map((row) => ({
      d: row.d,
      exact: row.e.exact,
      elev: `${row.e.exact ? '' : '≈'}${fmt(row.e.v)}`,
      clicks: row.clicks ?? '—',
      wind: row.w ? fmt(row.w.v, 2) : '—',
    })),
  );

  private readonly group = computed(() => {
    const data = this.data();
    return data?.ammo ? groupStats(this.store.diary(), data.rifle.id, data.ammo.id) : null;
  });

  protected readonly footnote = computed(() => {
    const data = this.data();
    if (!data) return '';
    const temps = data.points.temps;
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const temperature = temps.length ? `, t° ${min === max ? min : `${min}…${max}`} °C` : '';
    const group = this.group();
    const grouping = group ? ` Кучн. ${fmtAng(group.avg, this.settings.groupUnit())}.` : '';
    return `Жирное — подтверждено, ≈ — между точками. По ${data.points.sessions} стр.${temperature}.${grouping}`;
  });

  protected readonly warnings = computed(() => {
    const data = this.data();
    if (!data?.ammo) return [];
    const diary = this.store.diary();
    const card = this.view.card();
    const { rifle, ammo, points } = data;
    const notes = zeroNotes(ammo, points, rifle.units);
    const devices = devicesUsed(diary, rifle.id, ammo.id);
    if (card.device === '*' && devices.length > 1) {
      notes.unshift({
        kind: 'warn',
        text: `Данные сняты с разными устройствами (${devices.map(devName).join(', ')}): точка попадания у них разная. Выберите одно в «Связке», иначе поправки смешаются.`,
      });
    }
    const shift =
      card.rest === '*' ? restShift(diary, rifle.id, ammo.id, rifle.units, card.device) : null;
    if (shift) {
      const list = shift
        .map((row) => `${restName(row.rest) || 'не указана'} ${fmtSigned(row.avg, 2)}`)
        .join(', ');
      notes.unshift({
        kind: 'warn',
        text: `С разных опор группа ложится по-разному по вертикали: ${list} ${rifle.units}. Выберите опору, иначе поправки смешаются.`,
      });
    }
    return notes;
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.closePng());
  }

  protected async savePng(): Promise<void> {
    const data = this.data();
    if (!data || this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const options = this.exportOptions();
      const blob = await renderCardPng(data, options);
      const file = new File([blob], cardFileName(data, options), { type: 'image/png' });
      const result = navigator.canShare?.({ files: [file] }) ? await saveFile(file) : 'needs-tap';
      if (result === 'needs-tap') this.pngUrl.set(URL.createObjectURL(blob));
    } catch {
      this.message.set('Не удалось сделать PNG.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async shareText(): Promise<void> {
    const data = this.data();
    if (!data) return;
    this.message.set(null);
    const text = cardText(data, this.exportOptions());
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        this.message.set('Карта скопирована текстом.');
      }
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        this.message.set('Не удалось поделиться картой.');
      }
    }
  }

  protected closePng(): void {
    const url = this.pngUrl();
    if (url) URL.revokeObjectURL(url);
    this.pngUrl.set(null);
  }

  private exportOptions(): CardExportOptions {
    const { size, wind, device, rest } = this.view.card();
    return { size, wind, device, rest, group: this.group(), groupUnit: this.settings.groupUnit() };
  }
}
