import { expect, Page } from '@playwright/test';
import jpeg from 'jpeg-js';
import { readFileSync } from 'node:fs';

const EXAMPLE = readFileSync('src/app/core/data/testing/example.v1.json');

/** Loads the example diary through «Импорт», as a person would. */
export async function seed(page: Page): Promise<void> {
  await page.goto('/more');
  await page.locator('input[type=file][accept*="json"]').setInputFiles({
    name: 'example.json',
    mimeType: 'application/json',
    buffer: EXAMPLE,
  });
  await page.getByRole('button', { name: 'Заменить всё' }).click();
  await expect(page.getByText('Импорт завершён')).toBeVisible();
}

/** A pale sheet with a dark square: something to mark up. */
export function photo(): { name: string; mimeType: string; buffer: Buffer } {
  const [width, height] = [600, 800];
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark = Math.abs(x - 300) < 60 && Math.abs(y - 400) < 60;
      const i = (y * width + x) * 4;
      data.fill(dark ? 30 : 230, i, i + 3);
      data[i + 3] = 255;
    }
  }
  return {
    name: 'target.jpg',
    mimeType: 'image/jpeg',
    buffer: jpeg.encode({ data, width, height }).data,
  };
}

interface Box {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Fields side by side do not overlap and are of one height; nothing goes past the screen.
 * `where` names the screen in the failures; `within` is the dialog on top, if any.
 */
export async function expectTidyFields(page: Page, where: string, within = 'body'): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const { boxes, width, scrollWidth } = await page.evaluate((within) => {
    const skip = new Set(['checkbox', 'radio', 'file', 'hidden']);
    const root = document.querySelector(within) ?? document.body;
    const fields = [...root.querySelectorAll<HTMLElement>('input, select, textarea')].filter(
      (el) => {
        if (el instanceof HTMLInputElement && skip.has(el.type)) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      },
    );
    const label = (el: HTMLElement): string =>
      el.getAttribute('aria-label') ||
      el.closest('label')?.textContent?.trim().split('\n')[0].trim() ||
      el.getAttribute('formcontrolname') ||
      el.tagName.toLowerCase();
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      boxes: fields.map((el) => {
        const { left, right, top, bottom } = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          name: label(el),
          left,
          right,
          top,
          bottom,
          // Stepper values are big numbers in a tap area, not boxed fields.
          boxed: !el.classList.contains('big'),
          appearance:
            style.getPropertyValue('appearance') || style.getPropertyValue('-webkit-appearance'),
          display: style.display,
          minWidth: style.minWidth,
          fontSize: style.fontSize,
          height: bottom - top,
          textarea: el.tagName === 'TEXTAREA',
        };
      }),
    };
  }, within);
  expect(boxes.length, `${where}: no fields found`).toBeGreaterThan(0);
  const problems: string[] = [];
  if (scrollWidth > width) problems.push(`page scrolls sideways: ${scrollWidth} > ${width}`);
  for (const box of boxes) {
    if (box.left < -0.5 || box.right > width + 0.5) {
      problems.push(`«${box.name}» goes past the screen: ${box.left}…${box.right} of ${width}`);
    }
  }
  for (const box of boxes) {
    if (!box.boxed) continue;
    const off = [
      box.appearance !== 'none' && `appearance: ${box.appearance}`,
      box.display !== 'block' && `display: ${box.display}`,
      box.minWidth !== '0px' && `min-width: ${box.minWidth}`,
      box.fontSize !== '17px' && `font-size: ${box.fontSize}`,
      !box.textarea && Math.abs(box.height - 44) > 0.5 && `height: ${box.height}px`,
    ].filter(Boolean);
    if (off.length) problems.push(`«${box.name}» is not the common field: ${off.join(', ')}`);
  }
  boxes.forEach((a: Box, i) => {
    for (const b of boxes.slice(i + 1)) {
      const sameRow = a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      if (!sameRow) continue;
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5) {
        problems.push(`«${a.name}» and «${b.name}» overlap`);
      }
      const [ha, hb] = [a.bottom - a.top, b.bottom - b.top];
      if (Math.abs(ha - hb) > 0.5) {
        problems.push(`«${a.name}» (${ha}px) and «${b.name}» (${hb}px) differ in height`);
      }
    }
  });
  expect(problems, where).toEqual([]);
}
