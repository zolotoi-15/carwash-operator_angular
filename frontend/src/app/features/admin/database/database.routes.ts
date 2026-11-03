import { Routes } from '@angular/router';
export const DATABASE_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./database-backup/database-backup.component').then(m => m.DatabaseBackupComponent) }
];
