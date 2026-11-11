import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Safari ignores user-scalable=no in a tab, so its own pinch events are cancelled here;
// the target photo zooms through pointer events, which this does not touch.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

// Until Angular takes over app-root, the splash stays there; on failure it gives way to a reason.
bootstrapApplication(App, appConfig).catch((err) => {
  console.error(err);
  const root = document.querySelector('app-root');
  if (root) {
    root.innerHTML =
      '<p style="padding: 24px 16px; font-size: 16px">' +
      'Не удалось запустить приложение. Закройте его и откройте снова.</p>';
  }
});
