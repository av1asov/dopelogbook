import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const iPhone = devices['iPhone 14 Pro'];

/** Form layout in WebKit, the engine of Safari on iPhone: the narrowest, the target and the widest. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  projects: [
    { name: 'iphone-375', use: { ...iPhone, viewport: { width: 375, height: 812 } } },
    { name: 'iphone-14-pro', use: { ...iPhone } },
    { name: 'iphone-430', use: { ...iPhone, viewport: { width: 430, height: 932 } } },
  ],
  webServer: {
    command: `ng serve --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
