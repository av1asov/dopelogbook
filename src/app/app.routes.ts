import { Routes } from '@angular/router';
import { PlaceholderPage } from './features/placeholder/placeholder-page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'range' },
  { path: 'journal', component: PlaceholderPage, data: { title: 'Журнал' } },
  { path: 'journal/:id', component: PlaceholderPage, data: { title: 'Запись стрельбы' } },
  { path: 'range', component: PlaceholderPage, data: { title: 'На рубеже' } },
  { path: 'card', component: PlaceholderPage, data: { title: 'DOPE-карта' } },
  {
    path: 'stats',
    loadComponent: () =>
      import('./features/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
    data: { title: 'Статистика' },
  },
  { path: 'more', component: PlaceholderPage, data: { title: 'Ещё' } },
  { path: '**', redirectTo: 'range' },
];
