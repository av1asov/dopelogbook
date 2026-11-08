import { inject, Injectable, signal } from '@angular/core';
import { Diary } from '../ballistics/model';
import { DiaryRepository } from './repository';

const EMPTY: Diary = { rifles: [], ammo: [], sessions: [] };

/** The diary as signals for the screens. Reads and writes go through the repository. */
@Injectable({ providedIn: 'root' })
export class DiaryStore {
  private readonly repository = inject(DiaryRepository);

  readonly diary = signal<Diary>(EMPTY);
  readonly ready = signal(false);
  readonly loadFailed = signal(false);
  readonly persisted = signal(false);

  async init(): Promise<void> {
    void this.requestPersistence();
    try {
      await this.reload();
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.ready.set(true);
    }
  }

  async reload(): Promise<void> {
    this.diary.set(await this.repository.diary());
  }

  private async requestPersistence(): Promise<void> {
    try {
      this.persisted.set((await navigator.storage?.persist?.()) ?? false);
    } catch {
      this.persisted.set(false);
    }
  }
}
