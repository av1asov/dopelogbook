import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { PhotoRef, Session } from '../../core/ballistics';
import { DiaryStore } from '../../core/data/diary-store';
import { SettingsStore } from '../../core/data/settings-store';
import { marksOverlay } from '../../core/target/measure';
import { renderShareImage } from './share-image';
import {
  DEFAULT_SHARE_OPTIONS,
  seriesSummary,
  seriesText,
  sessionText,
  shareFileName,
  ShareOptions,
} from './share-text';

/** A series to share, with its photo when there is one. */
export interface ShareItem {
  si: number;
  number: number;
  photo: PhotoRef | null;
  holeMm?: number;
}

const OPTIONS_KEY = 'shareOptions';
/** Messengers take a few pictures with a message; more would be a gallery. */
export const MAX_SHARED_PICTURES = 4;

/** Screen 15ж: what to put in the picture and the message, then the iOS share sheet. */
@Component({
  selector: 'app-share-sheet',
  template: `
    <div class="share" role="dialog" [attr.aria-label]="heading()">
      <header>
        <button type="button" class="cancel" (click)="closed.emit()">Отмена</button>
        <b>{{ heading() }}</b>
        <span></span>
      </header>
      <main>
        <div class="previews" [class.many]="urls().length > 1">
          @for (url of urls(); track url) {
            <img [src]="url" alt="Картинка для отправки" />
          } @empty {
            @if (rendering()) {
              <div class="placeholder">Готовлю картинку…</div>
            }
          }
        </div>

        <section class="switches">
          @if (hasMarks()) {
            <label>
              <span>Фото с разметкой</span>
              <input
                type="checkbox"
                role="switch"
                [checked]="options().marks"
                (change)="set('marks', $event)"
              />
            </label>
          }
          <label>
            <span>Винтовка, патрон, прицел</span>
            <input
              type="checkbox"
              role="switch"
              [checked]="options().combo"
              (change)="set('combo', $event)"
            />
          </label>
          <label>
            <span>Условия <small>· погода, ветер</small></span>
            <input
              type="checkbox"
              role="switch"
              [checked]="options().conditions"
              (change)="set('conditions', $event)"
            />
          </label>
          <label>
            <span
              >Место
              @if (session().place) {
                <small>· {{ session().place }}</small>
              }
            </span>
            <input
              type="checkbox"
              role="switch"
              [checked]="options().place"
              (change)="set('place', $event)"
            />
          </label>
        </section>

        <label class="text">
          <span class="section-title">Текст к сообщению</span>
          <textarea
            class="input num"
            rows="4"
            [value]="text()"
            (input)="edit($event)"
            aria-label="Текст к сообщению"
          ></textarea>
        </label>

        @if (message(); as note) {
          <p class="note">{{ note }}</p>
        }

        <button type="button" class="go" [disabled]="rendering()" (click)="share()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12M7 8l5-5 5 5" />
            <path d="M5 12v8h14v-8" />
          </svg>
          Поделиться…
        </button>
      </main>
    </div>
  `,
  styles: `
    .share {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: flex;
      flex-direction: column;
      padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px);
      background: var(--paper);
      color: var(--ink);
    }

    header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      padding: 0 16px;
      border-bottom: 1px solid var(--rule);
      background: var(--sheet);
    }

    header b {
      font-size: 17px;
    }

    .cancel {
      justify-self: start;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--pen);
      font-size: 16px;
    }

    main {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      padding: 12px 16px 16px;
      overflow-y: auto;
    }

    .previews {
      display: flex;
      flex: none;
      justify-content: center;
      gap: 8px;
    }

    .previews img,
    .placeholder {
      width: 236px;
      aspect-ratio: 4 / 5;
      box-shadow: 0 2px 10px rgb(0 0 0 / 18%);
    }

    .previews.many {
      justify-content: flex-start;
      overflow-x: auto;
    }

    .previews.many img {
      flex: none;
      width: 160px;
    }

    .placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--sheet);
      color: var(--ink-2);
      font-size: 14px;
    }

    .switches {
      display: flex;
      flex: none;
      flex-direction: column;
      border: 1px solid var(--rule);
      background: var(--sheet);
    }

    .switches label {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 0 12px;
      font-size: 15px;
    }

    .switches label + label {
      border-top: 1px solid var(--rule);
    }

    .switches span {
      flex: 1;
    }

    small {
      color: var(--ink-2);
      font-size: 13px;
    }

    input[role='switch'] {
      position: relative;
      flex: none;
      width: 46px;
      height: 28px;
      margin: 0;
      border-radius: 14px;
      background: var(--rule);
      appearance: none;
      transition: background 0.15s;
    }

    input[role='switch']::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgb(0 0 0 / 30%);
      transition: transform 0.15s;
    }

    input[role='switch']:checked {
      background: var(--ok);
    }

    input[role='switch']:checked::after {
      transform: translateX(18px);
    }

    .text {
      display: flex;
      flex: none;
      flex-direction: column;
      gap: 4px;
    }

    textarea.input {
      height: auto;
      min-height: 112px;
      line-height: 1.45;
    }

    .note {
      margin: 0;
      color: var(--ink-2);
      font-size: 14px;
    }

    .go {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 52px;
      margin-top: auto;
      border: 2px solid var(--mark-ink);
      border-radius: 8px;
      background: var(--mark);
      color: var(--mark-ink);
      font-size: 17px;
      font-weight: 700;
    }

    .go:disabled {
      opacity: 0.5;
    }

    .go svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareSheet {
  private readonly store = inject(DiaryStore);
  private readonly settings = inject(SettingsStore);

  readonly session = input.required<Session>();
  /** One series, or every series of the session. */
  readonly items = input.required<ShareItem[]>();
  readonly whole = input(false);
  readonly closed = output<void>();

  protected readonly options = signal<ShareOptions>(DEFAULT_SHARE_OPTIONS);
  /** The text as typed over; null while it follows the switches. */
  private readonly typed = signal<string | null>(null);
  protected readonly blobs = signal<Blob[]>([]);
  protected readonly urls = signal<string[]>([]);
  protected readonly message = signal<string | null>(null);
  protected readonly rendering = signal(true);
  private renders = 0;

  protected readonly heading = computed(() =>
    this.whole() ? 'Поделиться стрельбой' : 'Поделиться серией',
  );

  /** The pictures: one per series with a photo, at most four; a series without one gets a plate. */
  private readonly pictured = computed(() => {
    const items = this.items();
    if (!this.whole()) return items.slice(0, 1);
    return items.filter((item) => item.photo).slice(0, MAX_SHARED_PICTURES);
  });

  protected readonly hasMarks = computed(() => this.pictured().some((item) => item.photo?.marks));

  private readonly generated = computed(() => {
    const session = this.session();
    const diary = this.store.diary();
    const unit = this.settings.groupUnit();
    const options = this.options();
    const items = this.items();
    if (this.whole()) return sessionText(diary, session, items, options, unit);
    const [item] = items;
    return item
      ? seriesText(seriesSummary(diary, session, item.si, item.number, options, unit))
      : '';
  });

  protected readonly text = computed(() => this.typed() ?? this.generated());

  constructor() {
    void this.settings.readSetting<ShareOptions>(OPTIONS_KEY).then((saved) => {
      if (saved) this.options.set({ ...DEFAULT_SHARE_OPTIONS, ...saved });
    });
    effect(() => {
      const session = this.session();
      const items = this.pictured();
      const options = this.options();
      const diary = this.store.diary();
      const unit = this.settings.groupUnit();
      untracked(() => void this.render(session, items, options, diary, unit));
    });
    inject(DestroyRef).onDestroy(() => this.urls().forEach((url) => URL.revokeObjectURL(url)));
  }

  private async render(
    session: Session,
    items: ShareItem[],
    options: ShareOptions,
    diary: ReturnType<DiaryStore['diary']>,
    unit: ReturnType<SettingsStore['groupUnit']>,
  ): Promise<void> {
    const run = ++this.renders;
    this.rendering.set(true);
    const blobs = await Promise.all(
      items.map(async (item) => {
        const photo = item.photo ? await this.store.getPhoto(item.photo.id) : null;
        const marks = item.photo?.marks;
        const overlay = marks ? marksOverlay(marks) : [];
        const target =
          overlay.find((t) => t.si === item.si) ??
          (overlay.length === 1 && item.photo?.si === item.si ? overlay[0] : null);
        const summary = seriesSummary(diary, session, item.si, item.number, options, unit);
        return renderShareImage(
          { photo: photo ?? null, marks, target, holeMm: item.holeMm },
          summary,
          options.marks,
        );
      }),
    );
    if (run !== this.renders) return;
    this.urls().forEach((url) => URL.revokeObjectURL(url));
    this.blobs.set(blobs);
    this.urls.set(blobs.map((blob) => URL.createObjectURL(blob)));
    this.rendering.set(false);
  }

  protected set(key: keyof ShareOptions, event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.options.update((options) => ({ ...options, [key]: value }));
    // The switches rewrite the message; what was typed over gives way to them.
    this.typed.set(null);
    void this.settings.writeSetting(OPTIONS_KEY, this.options());
  }

  protected edit(event: Event): void {
    this.typed.set((event.target as HTMLTextAreaElement).value);
  }

  /** The iOS share sheet with the pictures and the text; elsewhere a download and the clipboard. */
  protected async share(): Promise<void> {
    const session = this.session();
    const items = this.pictured();
    const files = this.blobs().map(
      (blob, i) =>
        new File([blob], shareFileName(session, this.whole() ? null : (items[i]?.number ?? null)), {
          type: 'image/jpeg',
        }),
    );
    const text = this.text();
    this.message.set(null);
    try {
      if (files.length && navigator.canShare?.({ files })) {
        await navigator.share({ files, text });
        return;
      }
      if (!files.length && navigator.share) {
        await navigator.share({ text });
        return;
      }
      for (const file of files) download(file);
      await navigator.clipboard?.writeText(text);
      this.message.set(
        files.length ? 'Картинка сохранена в «Файлы», текст скопирован.' : 'Текст скопирован.',
      );
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        this.message.set('Не удалось поделиться. Попробуйте ещё раз.');
      }
    }
  }
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
