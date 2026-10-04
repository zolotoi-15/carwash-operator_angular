<<<<<<< Updated upstream
﻿import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { RoleGuard } from '../../core/guards/role.guard';
import { Role } from '../../core/models/role.enum';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
=======
export const ADMIN_ROUTES: Routes = [
  {
    path: 'admin',
>>>>>>> Stashed changes
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: [Role.Administrator, Role.Developer] },
    children: [
      { path: 'users', loadChildren: () => import('./users/users.routes').then(m => m.USERS_ROUTES) },
      { path: 'groups', loadChildren: () => import('./groups/groups.routes').then(m => m.GROUPS_ROUTES) },
<<<<<<< Updated upstream
      { path: 'permissions', canActivate: [RoleGuard], data: { roles: [Role.Developer] },
        loadChildren: () => import('./permissions/permissions.routes').then(m => m.PERMISSIONS_ROUTES) },
      { path: 'database', canActivate: [RoleGuard], data: { roles: [Role.Developer] },
        loadChildren: () => import('./database/database.routes').then(m => m.DATABASE_ROUTES) },
      { path: 'kkm', canActivate: [RoleGuard], data: { roles: [Role.Developer] },
=======
      { path: 'permissions',
        canActivate: [RoleGuard],
        data: { roles: [Role.Developer] },
        loadChildren: () => import('./permissions/permissions.routes').then(m => m.PERMISSIONS_ROUTES) },
      { path: 'database',
        canActivate: [RoleGuard],
        data: { roles: [Role.Developer] },
        loadChildren: () => import('./database/database.routes').then(m => m.DATABASE_ROUTES) },
      { path: 'kkm',
        canActivate: [RoleGuard],
        data: { roles: [Role.Developer] },
>>>>>>> Stashed changes
        loadChildren: () => import('./kkm/kkm.routes').then(m => m.KKM_ROUTES) },
      { path: 'settings', loadChildren: () => import('./settings/settings.routes').then(m => m.SETTINGS_ROUTES) }
    ]
  }
<<<<<<< Updated upstream
];
=======
];
>>>>>>> Stashed changes
