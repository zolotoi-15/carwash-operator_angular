import { Routes } from '@angular/router';
export const KKM_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./kkm-list/kkm-list.component').then(m => m.KkmListComponent) }
];
