import { Routes } from '@angular/router';
import { AmmoEditPage } from './features/ammo/ammo-edit-page';
import { AmmoPage } from './features/ammo/ammo-page';
import { MorePage } from './features/more/more-page';
import { PlaceholderPage } from './features/placeholder/placeholder-page';
import { RangePage } from './features/range/range-page';
import { RifleEditPage } from './features/rifles/rifle-edit-page';
import { RiflesPage } from './features/rifles/rifles-page';

const noTabs = { hideTabs: true };

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'range' },
  { path: 'journal', component: PlaceholderPage, data: { title: 'Журнал' } },
  { path: 'journal/:id', component: PlaceholderPage, data: { title: 'Запись стрельбы' } },
  { path: 'range', component: RangePage },
  { path: 'card', component: PlaceholderPage, data: { title: 'DOPE-карта' } },
  {
    path: 'stats',
    loadComponent: () =>
      import('./features/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
    data: { title: 'Статистика' },
  },
  { path: 'more', component: MorePage },
  { path: 'more/rifles', component: RiflesPage },
  { path: 'more/rifles/new', component: RifleEditPage, data: noTabs },
  { path: 'more/rifles/:id', component: RifleEditPage, data: noTabs },
  { path: 'more/ammo', component: AmmoPage },
  { path: 'more/ammo/new', component: AmmoEditPage, data: noTabs },
  { path: 'more/ammo/:id', component: AmmoEditPage, data: noTabs },
  { path: '**', redirectTo: 'range' },
];
