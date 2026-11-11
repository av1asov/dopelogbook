import { computed, inject, Injectable, signal } from '@angular/core';
import { Diary, Doc, Session, TargetTemplate } from '../ballistics/model';
import { Snapshot } from './db';
import { DocByKind, DocInput, DiaryRepository, DocKind, RestoreMode } from './repository';

const EMPTY: Diary = { scopes: [], rifles: [], ammo: [], sessions: [] };
const byCreation = (a: Doc, b: Doc) => a.createdAt.localeCompare(b.createdAt);

/** The diary as signals for the screens. Reads and writes go through the repository. */
@Injectable({ providedIn: 'root' })
export class DiaryStore {
  private readonly repository = inject(DiaryRepository);

  readonly diary = signal<Diary>(EMPTY);
  readonly ready = signal(false);
  readonly loadFailed = signal(false);
  readonly persisted = signal(false);

  readonly rifles = computed(() => [...this.diary().rifles].sort(byCreation));
  readonly ammo = computed(() => [...this.diary().ammo].sort(byCreation));
  readonly scopes = computed(() => [...this.diary().scopes].sort(byCreation));
  private readonly ownTargets = signal<TargetTemplate[]>([]);
  readonly targets = computed(() => [...this.ownTargets()].sort(byCreation));
  /** Goes up when a stored photo changes under the same id. */
  readonly photoRevision = signal(0);

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
    const [diary, targets] = await Promise.all([
      this.repository.diary(),
      this.repository.list('target'),
    ]);
    this.diary.set(diary);
    this.ownTargets.set(targets);
  }

  async save<K extends DocKind>(kind: K, doc: DocInput<K>): Promise<DocByKind[K]> {
    const saved = await this.repository.put(kind, doc);
    await this.reload();
    return saved;
  }

  async remove(kind: DocKind, id: string): Promise<void> {
    await this.repository.delete(kind, id);
    await this.reload();
  }

  /** A rifle goes together with its sessions. */
  async removeRifle(id: string): Promise<void> {
    const sessions = this.diary().sessions.filter((s) => s.rifleId === id);
    for (const session of sessions) await this.repository.delete('session', session.id);
    await this.remove('rifle', id);
  }

  /** Removes the ammo and unlinks it from the rifles. */
  async removeAmmo(id: string): Promise<void> {
    for (const rifle of this.diary().rifles) {
      if (!rifle.combos.some((c) => c.ammoId === id)) continue;
      await this.repository.put('rifle', {
        ...rifle,
        combos: rifle.combos.filter((c) => c.ammoId !== id),
      });
    }
    await this.remove('ammo', id);
  }

  /** Removes the scope and takes it off the rifles. */
  async removeScope(id: string): Promise<void> {
    for (const rifle of this.diary().rifles) {
      if (!rifle.mounts.some((m) => m.scopeId === id)) continue;
      await this.repository.put('rifle', {
        ...rifle,
        mounts: rifle.mounts.filter((m) => m.scopeId !== id),
      });
    }
    await this.remove('scope', id);
  }

  getPhoto(id: string): Promise<Blob | undefined> {
    return this.repository.getPhoto(id);
  }

  /**
   * «На рубеж» on a closed record. Only one record is open on the range at a time, and the
   * draft of its series is not saved anywhere else, so an open record is never closed here.
   */
  async reopenSession(id: string): Promise<boolean> {
    const sessions = this.diary().sessions;
    if (sessions.some((s) => s.open && s.id !== id)) return false;
    const session = sessions.find((s) => s.id === id);
    if (!session) return false;
    await this.save('session', { ...session, open: true });
    return true;
  }

  addPhoto(blob: Blob): Promise<string> {
    return this.repository.putPhoto(blob);
  }

  /** A retaken or turned shot keeps the place of the old one. */
  async replacePhoto(id: string, blob: Blob): Promise<void> {
    await this.repository.putPhoto(blob, id);
    this.photoRevision.update((n) => n + 1);
  }

  removePhoto(id: string): Promise<void> {
    return this.repository.deletePhoto(id);
  }

  async detachPhoto(session: Session, photoId: string): Promise<void> {
    await this.repository.detachPhoto(session, photoId);
    await this.reload();
  }

  async reattachPhoto(session: Session, photoId: string): Promise<void> {
    await this.repository.reattachPhoto(session, photoId);
    await this.reload();
  }

  snapshot(): Promise<Snapshot> {
    return this.repository.snapshot();
  }

  async restore(snapshot: Snapshot, mode: RestoreMode): Promise<void> {
    await this.repository.restore(snapshot, mode);
    await this.reload();
  }

  private async requestPersistence(): Promise<void> {
    try {
      this.persisted.set((await navigator.storage?.persist?.()) ?? false);
    } catch {
      this.persisted.set(false);
    }
  }
}
