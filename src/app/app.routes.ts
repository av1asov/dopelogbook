import { Routes } from '@angular/router';
import { AmmoEditPage } from './features/ammo/ammo-edit-page';
import { AmmoPage } from './features/ammo/ammo-page';
import { CardPage } from './features/card/card-page';
import { JournalPage } from './features/journal/journal-page';
import { SessionEditPage } from './features/journal/session-edit-page';
import { SessionPage } from './features/journal/session-page';
import { MorePage } from './features/more/more-page';
import { RangePage } from './features/range/range-page';
import { RifleEditPage } from './features/rifles/rifle-edit-page';
import { RiflesPage } from './features/rifles/rifles-page';
import { ScopeEditPage } from './features/scopes/scope-edit-page';
import { ScopesPage } from './features/scopes/scopes-page';

const noTabs = { hideTabs: true };

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'range' },
  { path: 'journal', component: JournalPage },
  { path: 'journal/:id', component: SessionPage },
  { path: 'journal/:id/edit', component: SessionEditPage, data: noTabs },
  { path: 'range', component: RangePage },
  { path: 'card', component: CardPage },
  {
    path: 'stats',
    loadComponent: () => import('./features/stats/stats-page').then((m) => m.StatsPage),
  },
  { path: 'more', component: MorePage },
  { path: 'more/rifles', component: RiflesPage },
  { path: 'more/rifles/new', component: RifleEditPage, data: noTabs },
  { path: 'more/rifles/:id', component: RifleEditPage, data: noTabs },
  { path: 'more/scopes', component: ScopesPage },
  { path: 'more/scopes/new', component: ScopeEditPage, data: noTabs },
  { path: 'more/scopes/:id', component: ScopeEditPage, data: noTabs },
  { path: 'more/ammo', component: AmmoPage },
  { path: 'more/ammo/new', component: AmmoEditPage, data: noTabs },
  { path: 'more/ammo/:id', component: AmmoEditPage, data: noTabs },
  { path: '**', redirectTo: 'range' },
];
