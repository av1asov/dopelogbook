import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { DiaryStore } from '../core/data/diary-store';

/** Shows a stored target photo. */
@Component({
  selector: 'app-photo',
  template: `
    @if (url(); as src) {
      <img [src]="src" alt="Мишень" />
    }
  `,
  styles: `
    :host {
      display: block;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: var(--photo-fit, cover);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Photo {
  private readonly store = inject(DiaryStore);

  readonly photoId = input.required<string>();
  protected readonly url = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const id = this.photoId();
      this.store.photoRevision();
      let objectUrl: string | null = null;
      let cancelled = false;
      void this.store.getPhoto(id).then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        this.url.set(objectUrl);
      });
      onCleanup(() => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      });
    });
  }
}
