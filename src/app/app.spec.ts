import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideServiceWorker('ngsw-worker.js', { enabled: false })],
    }).compileComponents();
  });

  it('renders the five bottom tabs', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll('nav a');
    expect([...tabs].map((tab) => tab.textContent?.trim())).toEqual([
      'Журнал',
      'Рубеж',
      'Карта',
      'Статистика',
      'Ещё',
    ]);
  });
});
