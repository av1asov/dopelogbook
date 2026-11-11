import { expect, Page, test } from '@playwright/test';
import { expectTidyFields, photo, seed } from './layout';

/** Spec, «iOS-требования»: fields in one row do not overlap, are of one height, fit the screen. */

test.beforeEach(async ({ page }) => {
  await seed(page);
});

async function openFirst(page: Page, list: string, link: string): Promise<void> {
  await page.goto(list);
  await page.locator(link).first().click();
}

test('Новая стрельба', async ({ page }) => {
  await page.goto('/range');
  await expect(page.getByRole('heading', { name: 'Новая стрельба' })).toBeVisible();
  await expect(page.getByText('Серии пристрелки пойдут только в ресурс ствола')).toBeVisible();
  await expectTidyFields(page, 'Новая стрельба');
  await page.locator('.zero-plan').click();
  await expect(page.getByRole('checkbox', { name: 'Начать с пристрелки' })).toBeChecked();
  await expectTidyFields(page, 'Новая стрельба · план пристрелки');
});

test('Рубеж', async ({ page }) => {
  await page.goto('/range');
  await page.getByRole('button', { name: 'На рубеж' }).click();
  await expect(page.getByRole('textbox', { name: 'Выстрелов' })).toBeVisible();
  await expectTidyFields(page, 'Рубеж');
});

test('Пристрелка', async ({ page }) => {
  await page.goto('/range');
  await page.getByRole('checkbox', { name: 'Начать с пристрелки' }).check();
  await page.getByRole('button', { name: 'На рубеж' }).click();
  await expect(page.getByText('Режим пристрелки')).toBeVisible();
  await expectTidyFields(page, 'Пристрелка');
});

test('Разметка мишени', async ({ page }) => {
  await page.goto('/range');
  await page.getByRole('button', { name: 'На рубеж' }).click();
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles(photo());
  await expect(page.getByRole('dialog', { name: 'Разметка мишени' })).toBeVisible();
  await page.getByRole('button', { name: 'Масштаб вручную' }).click();
  await expectTidyFields(page, 'Разметка · масштаб', '.measure');
  await page.getByRole('button', { name: 'Углы листа' }).click();
  await expectTidyFields(page, 'Разметка · углы листа', '.measure');
});

test('Запись · изменить', async ({ page }) => {
  await openFirst(page, '/journal', 'a.entry');
  await page.getByRole('link', { name: 'Изменить' }).click();
  await expect(page.locator('textarea')).toBeVisible();
  await expectTidyFields(page, 'Запись · изменить');
});

test('Запись · + Фото', async ({ page }) => {
  await openFirst(page, '/journal', 'a.entry');
  await page.locator('input[type=file][multiple]').setInputFiles(photo());
  const measure = page.getByRole('dialog', { name: 'Разметка мишени' });
  await expect(measure).toBeVisible();
  // Several series without a photo: each target on it picks its series, as on a sheet.
  await expect(measure.getByText(/Фото листа/)).toBeVisible();
  await measure.getByRole('button', { name: 'Отмена' }).click();
  await expect(measure).toBeHidden();
});

test('Винтовка', async ({ page }) => {
  await openFirst(page, '/more/rifles', 'a.card');
  await expect(page.getByRole('heading', { name: 'Прицелы' })).toBeVisible();
  await expectTidyFields(page, 'Винтовка');
  await page.goto('/more/rifles/new');
  await expectTidyFields(page, 'Новая винтовка');
});

test('Патрон', async ({ page }) => {
  await openFirst(page, '/more/ammo', 'a.title-row');
  await expect(page.getByRole('heading', { name: 'Рецепт' })).toBeVisible();
  await expectTidyFields(page, 'Патрон · рецепт');
  await page.goto('/more/ammo/new');
  await expectTidyFields(page, 'Новый патрон');
});

test('Прицел', async ({ page }) => {
  await openFirst(page, '/more/scopes', 'a.title-row');
  await expect(page.getByRole('heading', { name: 'На винтовках' })).toBeVisible();
  await expectTidyFields(page, 'Прицел');
  await page.goto('/more/scopes/new');
  await expectTidyFields(page, 'Новый прицел');
});

test('Новая мишень', async ({ page }) => {
  await page.goto('/more/targets/new');
  await page.getByRole('button', { name: 'свой' }).click();
  await page.getByRole('button', { name: /Опорный элемент/ }).click();
  await page.getByRole('button', { name: 'кольца' }).click();
  await expect(page.getByLabel('Тип кольца').first()).toBeVisible();
  await expectTidyFields(page, 'Новая мишень');
});

test('Разметить вручную', async ({ page }) => {
  await page.goto('/more/targets/new');
  await page.locator('input[type=file][accept="image/*"]').last().setInputFiles(photo());
  await page.getByRole('button', { name: /Разметить вручную/ }).click();
  await page.getByRole('tab', { name: /Масштаб/ }).click();
  await expect(page.getByLabel('Длина отрезка, мм')).toBeVisible();
  await expectTidyFields(page, 'Разметить вручную · масштаб', '.manual');
});

test('Карта · связка', async ({ page }) => {
  await page.goto('/card');
  await page.getByRole('button', { name: 'Выбрать патрон, прицел и опору' }).click();
  await expectTidyFields(page, 'Карта · связка');
});
