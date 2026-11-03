import { Routes } from '@angular/router';
export const PERMISSIONS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./permission-editor/permission-editor.component').then(m => m.PermissionEditorComponent) }
];
