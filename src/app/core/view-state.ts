import { computed, inject, Injectable, signal } from '@angular/core';
import { DiaryStore } from './data/diary-store';

export interface CardView {
  step: number;
  from: number | null;
  to: number | null;
  device: string;
  rest: string;
  size: 'wide' | 'strip';
  wind: boolean;
}

const DEFAULT_CARD: CardView = {
  step: 50,
  from: null,
  to: null,
  device: '*',
  rest: '*',
  size: 'wide',
  wind: true,
};

/** What the journal, card and statistics are currently showing. */
@Injectable({ providedIn: 'root' })
export class ViewState {
  private readonly store = inject(DiaryStore);
  private readonly rifleId = signal<string | null>(null);

  readonly ammoId = signal<string | null>(null);
  /** The card always shows one scope; null means the mounted one. */
  readonly scopeId = signal<string | null>(null);
  /** Filters the statistics; null means every scope. */
  readonly statsScopeId = signal<string | null>(null);
  readonly card = signal<CardView>(DEFAULT_CARD);

  readonly rifle = computed(() => {
    const rifles = this.store.rifles();
    return rifles.find((r) => r.id === this.rifleId()) ?? rifles[0] ?? null;
  });

  selectRifle(id: string): void {
    this.rifleId.set(id);
    this.ammoId.set(null);
    this.scopeId.set(null);
    this.statsScopeId.set(null);
    this.card.update((card) => ({ ...card, device: '*', rest: '*' }));
  }

  nextRifle(): void {
    const rifles = this.store.rifles();
    const current = rifles.findIndex((r) => r.id === this.rifle()?.id);
    if (rifles.length > 1) this.selectRifle(rifles[(current + 1) % rifles.length].id);
  }

  updateCard(change: Partial<CardView>): void {
    this.card.update((card) => ({ ...card, ...change }));
  }
}
