import { inject, Injectable, signal } from '@angular/core';
import { GroupUnit } from '../ballistics/model';
import { DiaryRepository } from './repository';

export type Theme = 'system' | 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly repository = inject(DiaryRepository);

  /** Unit for group sizes. Corrections always use the units of their scope. */
  readonly groupUnit = signal<GroupUnit>('MOA');
  readonly theme = signal<Theme>('system');
  readonly lastBackupAt = signal<string | null>(null);

  async init(): Promise<void> {
    try {
      const [groupUnit, theme, lastBackupAt] = await Promise.all([
        this.repository.getSetting<GroupUnit | 'MIL'>('groupUnit'),
        this.repository.getSetting<Theme>('theme'),
        this.repository.getSetting<string>('lastBackupAt'),
      ]);
      if (groupUnit) this.groupUnit.set(groupUnit === 'MIL' ? 'MRAD' : groupUnit);
      if (theme) this.theme.set(theme);
      if (lastBackupAt) this.lastBackupAt.set(lastBackupAt);
    } finally {
      this.applyTheme();
    }
  }

  async setGroupUnit(unit: GroupUnit): Promise<void> {
    this.groupUnit.set(unit);
    await this.repository.setSetting('groupUnit', unit);
  }

  async setTheme(theme: Theme): Promise<void> {
    this.theme.set(theme);
    this.applyTheme();
    await this.repository.setSetting('theme', theme);
  }

  readSetting<T>(key: string): Promise<T | undefined> {
    return this.repository.getSetting<T>(key);
  }

  writeSetting(key: string, value: unknown): Promise<void> {
    return this.repository.setSetting(key, value);
  }

  async markBackup(at: string): Promise<void> {
    this.lastBackupAt.set(at);
    await this.repository.setSetting('lastBackupAt', at);
  }

  private applyTheme(): void {
    const root = document.documentElement;
    if (this.theme() === 'system') delete root.dataset['theme'];
    else root.dataset['theme'] = this.theme();
  }
}
