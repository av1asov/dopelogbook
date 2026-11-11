import { expect, Page, test } from '@playwright/test';
import { seed } from './layout';

/** Spec, «Сохранение серии и завершение стрельбы»: the test at the end of the section. */

test.beforeEach(async ({ page }) => {
  await seed(page);
  await page.goto('/range');
  await page.getByRole('button', { name: 'На рубеж' }).click();
  await expect(page.getByRole('button', { name: 'Сохранить серию 1' })).toBeVisible();
});

async function finish(page: Page, state: string): Promise<void> {
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Завершить стрельбу?' });
  await expect(dialog.getByText(state)).toBeVisible();
  await dialog.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(page).toHaveURL(/\/journal\/.+/);
}

test('заполненная серия сохраняется вместе с завершением', async ({ page }) => {
  await page.getByLabel('Группа, мм').fill('30');
  await page.getByRole('button', { name: 'Сохранить серию 1' }).click();
  await expect(page.getByText('Серия 1 сохранена')).toBeVisible();
  await page.getByLabel('Группа, мм').fill('41');
  await finish(page, 'Серия 2 заполнена');
  await expect(page.locator('article.series')).toHaveCount(2);
  await expect(page.getByText('41 мм').first()).toBeVisible();
});

test('нетронутый черновик не сохраняется', async ({ page }) => {
  await page.getByLabel('Группа, мм').fill('30');
  await page.getByRole('button', { name: 'Сохранить серию 1' }).click();
  await expect(page.getByRole('button', { name: 'Сохранить серию 2' })).toBeVisible();
  await finish(page, 'Незаполненная серия 2 не сохранится');
  await expect(page.locator('article.series')).toHaveCount(1);
});

test('«Отменить» возвращает серию в черновик', async ({ page }) => {
  await page.getByLabel('Группа, мм').fill('30');
  await page.getByRole('button', { name: 'Сохранить серию 1' }).click();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByRole('button', { name: 'Сохранить серию 1' })).toBeVisible();
  await expect(page.getByLabel('Группа, мм')).toHaveValue('30');
});

test('черновик переживает закрытие вкладки', async ({ page }) => {
  await page.getByLabel('Группа, мм').fill('55');
  // The draft goes to IndexedDB on every change; give the write a moment to land.
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByLabel('Группа, мм')).toHaveValue('55');
});

test('на экране карты тёмная тема, PNG — белый', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  // Without file sharing the card opens as a picture to hold and save.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'canShare', { value: undefined }),
  );
  await page.goto('/card');
  const background = await page
    .locator('app-card-page')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe('rgb(251, 251, 248)');
  await page.getByRole('button', { name: 'Сохранить PNG' }).click();
  const image = page.getByRole('dialog', { name: 'Карта PNG' }).locator('img');
  await expect(image).toBeVisible();
  const corner = await image.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return [...g.getImageData(40, 40, 1, 1).data];
  });
  expect(corner).toEqual([255, 255, 255, 255]);
});
