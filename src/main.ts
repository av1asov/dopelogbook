import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Safari ignores user-scalable=no in a tab, so its own pinch events are cancelled here;
// the target photo zooms through pointer events, which this does not touch.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
