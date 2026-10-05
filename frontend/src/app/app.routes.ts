import { Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { RoleGuard } from './core/guards/role.guard';
import { Role } from './core/models/role.enum';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },

  // ===== Публичные =====
  { path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent) },
  { path: 'logout',
    loadComponent: () => import('./features/auth/logout/logout.component').then(m => m.LogoutComponent) },

  // ===== Основные =====
  { path: 'dashboard', canActivate: [AuthGuard],
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'reports', canActivate: [AuthGuard],
    loadComponent: () => import('./features/reports/report-list/report-list.component').then(m => m.ReportListComponent) },
  { path: 'client-cards', canActivate: [AuthGuard],
    loadComponent: () => import('./features/client-cards/card-list/card-list.component').then(m => m.CardListComponent) },

  // ===== Админка =====
  {
    path: 'admin',
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: [Role.ADMINISTRATOR, Role.DEVELOPER] },
    children: [
      { path: 'users',
        loadComponent: () => import('./features/admin/users/user-list/user-list.component').then(m => m.UserListComponent) },
      { path: 'users/create',
        loadComponent: () => import('./features/admin/users/user-form/user-form.component').then(m => m.UserFormComponent) },
      { path: 'users/edit/:id',
        loadComponent: () => import('./features/admin/users/user-form/user-form.component').then(m => m.UserFormComponent) },
      { path: 'groups',
        loadComponent: () => import('./features/admin/groups/group-list/group-list.component').then(m => m.GroupListComponent) },
      { path: 'permissions',
        canActivate: [RoleGuard],
        data: { roles: [Role.DEVELOPER] },
        loadComponent: () => import('./features/admin/permissions/permission-editor/permission-editor.component').then(m => m.PermissionEditorComponent) },
      { path: 'database',
        canActivate: [RoleGuard],
        data: { roles: [Role.DEVELOPER] },
        loadComponent: () => import('./features/admin/database/database-backup/database-backup.component').then(m => m.DatabaseBackupComponent) },
      { path: 'kkm',
        canActivate: [RoleGuard],
        data: { roles: [Role.DEVELOPER] },
        loadComponent: () => import('./features/admin/kkm/kkm-list/kkm-list.component').then(m => m.KkmListComponent) },

      // 👇 ПЕРЕНЕСЕНО СЮДА
      { path: 'settings',
        loadComponent: () => import('./features/admin/settings/general-settings/general-settings.component').then(m => m.GeneralSettingsComponent) }
    ]
  },

  { path: 'unauthorized',
    loadComponent: () => import('./shared/components/unauthorized/unauthorized.component').then(m => m.UnauthorizedComponent) },
  { path: '**', redirectTo: '/dashboard' }
];