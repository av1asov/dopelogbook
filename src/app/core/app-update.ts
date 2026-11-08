import { inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { filter, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AppUpdate {
  private readonly swUpdate = inject(SwUpdate);

  readonly enabled = this.swUpdate.isEnabled;
  readonly ready = toSignal(
    this.swUpdate.versionUpdates.pipe(
      filter((event) => event.type === 'VERSION_READY'),
      map(() => true),
    ),
    { initialValue: false },
  );

  async restart(): Promise<void> {
    await this.swUpdate.activateUpdate();
    document.location.reload();
  }
}
