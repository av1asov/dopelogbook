import { expect, test } from '@playwright/test';

/** Spec, «Сплэш-скрин». Nothing here depends on the screen, so one device is enough. */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-14-pro', 'одного устройства достаточно');
});

test('системный сплэш: картинка на каждый iPhone и тему', async ({ page, request }) => {
  await page.goto('/');
  const links = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((list) =>
    list.map((link) => ({
      href: (link as HTMLLinkElement).href,
      media: (link as HTMLLinkElement).media,
    })),
  );
  expect(links).toHaveLength(24);
  for (const theme of ['light', 'dark']) {
    expect(links.filter((l) => l.media.includes(`prefers-color-scheme: ${theme}`))).toHaveLength(
      12,
    );
  }
  for (const { href } of links) {
    const response = await request.get(href);
    expect(response.ok(), href).toBe(true);
    expect(response.headers()['content-type'], href).toContain('image/png');
  }
});

test('тот же сплэш, пока грузится приложение, и плавно уходит после', async ({ page, request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('class="splash"');
  await page.goto('/');
  // Outside app-root, so bootstrapping does not cut it off; taps pass through to the app.
  await expect(page.locator('app-root .splash')).toHaveCount(0);
  await expect(page.locator('.tabs')).toBeVisible();
  await expect(page.locator('.splash')).toHaveCount(0);
});

test('сплэш держится, пока его видно, а не моргает', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tabs')).toBeVisible();
  const shownFor = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const paint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
        const splash = document.querySelector('.splash');
        // Already fading or gone: it started no earlier than now, so now bounds it from below.
        if (!splash || splash.classList.contains('splash-out')) {
          return resolve(performance.now() - paint);
        }
        new MutationObserver(() => {
          if (splash.classList.contains('splash-out')) resolve(performance.now() - paint);
        }).observe(splash, { attributes: true });
      }),
  );
  expect(shownFor).toBeGreaterThanOrEqual(750);
});

test('манифест: тёмный фон запуска', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.background_color).toBe('#1d221f');
  expect(manifest.theme_color).toBe('#1d221f');
});
