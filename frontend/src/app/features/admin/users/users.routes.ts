import { Routes } from '@angular/router';
export const USERS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./user-list/user-list.component').then(m => m.UserListComponent) },
  { path: 'create', loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent) },
  { path: 'edit/:id', loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent) }
];
