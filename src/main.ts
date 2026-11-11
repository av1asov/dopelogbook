import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Safari ignores user-scalable=no in a tab, so its own pinch events are cancelled here;
// the target photo zooms through pointer events, which this does not touch.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

/** The mark stays on screen at least this long from the first paint, its fade-in included. */
const SPLASH_MIN_MS = 800;
/** Matches the opacity transition of .splash in index.html. */
const SPLASH_FADE_MS = 300;

/** Fades the splash out over the app once it has been seen, so it never just blinks. */
function hideSplash(): void {
  const splash = document.querySelector('.splash');
  if (!splash) return;
  const paint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
  const wait = Math.max(0, (paint ?? performance.now()) + SPLASH_MIN_MS - performance.now());
  setTimeout(() => {
    splash.classList.add('splash-out');
    setTimeout(() => splash.remove(), SPLASH_FADE_MS);
  }, wait);
}

bootstrapApplication(App, appConfig)
  .then(hideSplash)
  .catch((err) => {
    console.error(err);
    document.querySelector('.splash')?.remove();
    const root = document.querySelector('app-root');
    if (root) {
      root.innerHTML =
        '<p style="padding: 24px 16px; font-size: 16px">' +
        'Не удалось запустить приложение. Закройте его и откройте снова.</p>';
    }
  });
