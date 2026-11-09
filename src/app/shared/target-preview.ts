import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TargetTemplate } from '../core/ballistics';

/** A small drawing of a template: the sheet and what is printed on it. */
@Component({
  selector: 'app-target-preview',
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + t().sheet.w + ' ' + t().sheet.h"
      [attr.width]="width()"
      [attr.height]="height()"
      aria-hidden="true"
    >
      <rect
        [attr.width]="t().sheet.w"
        [attr.height]="t().sheet.h"
        fill="#ece7d9"
        stroke="#c9cdc3"
        stroke-width="4"
      />
      @if (grid(); as d) {
        <path [attr.d]="d" stroke="#b9b39f" stroke-width="3" fill="none" />
      }
      @for (target of t().targets; track target.n) {
        @switch (target.reference.kind) {
          @case ('square') {
            <rect
              fill="#2b2b2b"
              [attr.x]="target.x - size(target.reference) / 2"
              [attr.y]="target.y - size(target.reference) / 2"
              [attr.width]="size(target.reference)"
              [attr.height]="size(target.reference)"
            />
          }
          @case ('circle') {
            <circle
              fill="#2b2b2b"
              [attr.cx]="target.x"
              [attr.cy]="target.y"
              [attr.r]="size(target.reference) / 2"
            />
          }
          @case ('rings') {
            @for (d of diameters(target.reference); track d) {
              <circle
                fill="none"
                stroke="#2b2b2b"
                stroke-width="4"
                [attr.cx]="target.x"
                [attr.cy]="target.y"
                [attr.r]="d / 2"
              />
            }
          }
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
      flex: none;
      line-height: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetPreview {
  readonly template = input.required<Pick<TargetTemplate, 'sheet' | 'targets'>>();
  /** The longer side, px. */
  readonly length = input(62);

  protected readonly t = this.template;
  private readonly ratio = computed(
    () => this.length() / Math.max(this.t().sheet.w, this.t().sheet.h),
  );
  protected readonly width = computed(() => Math.round(this.t().sheet.w * this.ratio()));
  protected readonly height = computed(() => Math.round(this.t().sheet.h * this.ratio()));

  protected readonly grid = computed(() => {
    const { sheet, targets } = this.t();
    const reference = targets[0]?.reference;
    if (reference?.kind !== 'grid') return null;
    const lines: string[] = [];
    for (let x = reference.step; x < sheet.w; x += reference.step) lines.push(`M${x} 0V${sheet.h}`);
    for (let y = reference.step; y < sheet.h; y += reference.step) lines.push(`M0 ${y}H${sheet.w}`);
    return lines.join('');
  });

  protected size(reference: { size?: number }): number {
    return reference.size ?? 0;
  }

  protected diameters(reference: { diameters?: number[] }): number[] {
    return reference.diameters ?? [];
  }
}
