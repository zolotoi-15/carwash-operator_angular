import { Routes } from '@angular/router';
export const SETTINGS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./general-settings/general-settings.component').then(m => m.GeneralSettingsComponent) }
];
