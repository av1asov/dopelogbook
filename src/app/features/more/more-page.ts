import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { plural, rdate } from '../../core/ballistics';
import { AppUpdate } from '../../core/app-update';
import {
  BackupError,
  BackupSummary,
  BackupWarnings,
  buildBackup,
  ParsedBackup,
  parseBackup,
  summarize,
} from '../../core/data/backup';
import { DiaryStore } from '../../core/data/diary-store';
import { RestoreMode } from '../../core/data/repository';
import { SettingsStore, Theme } from '../../core/data/settings-store';
import { saveFile } from '../../core/save-file';

const BACKUP_MAX_AGE_DAYS = 7;
const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];
const THEME_NAMES: Record<Theme, string> = {
  system: 'как в системе',
  light: 'светлая',
  dark: 'тёмная',
};

interface ImportPreview {
  fileName: string;
  parsed: ParsedBackup;
  summary: BackupSummary;
  warnings: BackupWarnings;
}

const daysSince = (iso: string): number => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

@Component({
  selector: 'app-more-page',
  imports: [RouterLink],
  templateUrl: './more-page.html',
  styleUrl: './more-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MorePage implements OnInit {
  protected readonly store = inject(DiaryStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly update = inject(AppUpdate);

  protected readonly version = '1.0';
  protected readonly usedMb = signal<number | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly pendingFile = signal<File | null>(null);
  protected readonly preview = signal<ImportPreview | null>(null);

  protected readonly themeName = computed(() => THEME_NAMES[this.settings.theme()]);
  protected readonly hasData = computed(() => this.store.diary().sessions.length > 0);

  protected readonly backupAge = computed(() => {
    const last = this.settings.lastBackupAt();
    if (!last) return 'Копий ещё не было.';
    const days = daysSince(last);
    if (days === 0) return 'Последняя копия — сегодня.';
    return `Последняя копия — ${days} ${plural(days, 'день', 'дня', 'дней')} назад.`;
  });

  protected readonly backupOverdue = computed(() => {
    const last = this.settings.lastBackupAt();
    return this.hasData() && (!last || daysSince(last) > BACKUP_MAX_AGE_DAYS);
  });

  protected readonly replaceWarning = computed(() => {
    const { rifles, ammo, sessions } = this.store.diary();
    const total = rifles.length + ammo.length + sessions.length;
    return total
      ? `Сейчас в дневнике ${this.counts(rifles.length, ammo.length, sessions.length)}.`
      : '';
  });

  async ngOnInit(): Promise<void> {
    await this.refreshUsage();
  }

  protected async cycleTheme(): Promise<void> {
    const next = (THEME_ORDER.indexOf(this.settings.theme()) + 1) % THEME_ORDER.length;
    await this.settings.setTheme(THEME_ORDER[next]);
  }

  protected async exportBackup(): Promise<void> {
    this.clearStatus();
    this.busy.set('Готовлю файл…');
    try {
      const exportedAt = new Date().toISOString();
      const blob = await buildBackup(await this.store.snapshot(), exportedAt);
      const name = `dope-diary-${exportedAt.slice(0, 10)}.json`;
      this.pendingFile.set(new File([blob], name, { type: 'application/json' }));
      await this.savePending();
    } catch {
      this.error.set('Не удалось подготовить файл.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async savePending(): Promise<void> {
    const file = this.pendingFile();
    if (!file) return;
    try {
      const result = await saveFile(file);
      if (result === 'needs-tap') return;
      this.pendingFile.set(null);
      if (result === 'saved') {
        await this.settings.markBackup(new Date().toISOString());
        this.message.set('Файл сохранён.');
      }
    } catch {
      this.pendingFile.set(null);
      this.error.set('Не удалось сохранить файл.');
    }
  }

  protected async chooseFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.clearStatus();
    this.preview.set(null);
    this.busy.set('Читаю файл…');
    try {
      const parsed = parseBackup(await file.text());
      this.preview.set({
        fileName: file.name,
        parsed,
        summary: summarize(parsed.snapshot),
        warnings: parsed.warnings,
      });
    } catch (error) {
      this.error.set(error instanceof BackupError ? error.message : 'Не удалось прочитать файл.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async applyImport(mode: RestoreMode): Promise<void> {
    const preview = this.preview();
    if (!preview) return;
    this.busy.set('Загружаю данные…');
    try {
      await this.store.restore(preview.parsed.snapshot, mode);
      this.preview.set(null);
      this.message.set(`Импорт завершён: ${this.summaryText(preview.summary)}.`);
      await this.refreshUsage();
    } catch {
      this.error.set('Импорт не удался. Данные в дневнике не изменились.');
    } finally {
      this.busy.set(null);
    }
  }

  protected summaryText(s: BackupSummary): string {
    const photos = `${s.photos} фото`;
    return `${this.counts(s.rifles, s.ammo, s.sessions)}, ${photos}`;
  }

  protected formatBackupDate(iso: string | null): string {
    return iso ? rdate(iso.slice(0, 10)) : '';
  }

  private counts(rifles: number, ammo: number, sessions: number): string {
    return [
      `${rifles} ${plural(rifles, 'винтовка', 'винтовки', 'винтовок')}`,
      `${ammo} ${plural(ammo, 'патрон', 'патрона', 'патронов')}`,
      `${sessions} ${plural(sessions, 'запись', 'записи', 'записей')}`,
    ].join(', ');
  }

  private clearStatus(): void {
    this.message.set(null);
    this.error.set(null);
  }

  private async refreshUsage(): Promise<void> {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.usage != null) this.usedMb.set(Math.round(estimate.usage / 1_048_576));
  }
}
