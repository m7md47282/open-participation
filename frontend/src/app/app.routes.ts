import { Routes } from '@angular/router';
import { AdminPage } from './admin/admin.page';
import { PlayPage } from './play/play.page';
import { TestCasesPage } from './test-cases/test-cases.page';

export const routes: Routes = [
  { path: 'admin', component: AdminPage, title: 'Shares · Open Participation' },
  { path: 'test-cases', component: TestCasesPage, title: 'Test cases · Open Participation' },
  { path: 'play', component: PlayPage, title: 'Training · Open Participation' },
  { path: '', pathMatch: 'full', redirectTo: 'admin' },
  { path: '**', redirectTo: 'admin' },
];
