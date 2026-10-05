export const ADMIN_ROUTES: Routes = [
  {
    path: 'admin',
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: [Role.ADMINISTRATOR, Role.DEVELOPER] },
    children: [
      { path: 'users', loadChildren: () => import('./users/users.routes').then(m => m.USERS_ROUTES) },
      { path: 'groups', loadChildren: () => import('./groups/groups.routes').then(m => m.GROUPS_ROUTES) },
      { path: 'permissions',
        canActivate: [RoleGuard],
        data: { roles: [Role.DEVELOPER] },
        loadChildren: () => import('./permissions/permissions.routes').then(m => m.PERMISSIONS_ROUTES) },
      { path: 'database',
        canActivate: [RoleGuard],
        data: { roles: [Role.DEVELOPER] },
        loadChildren: () => import('./database/database.routes').then(m => m.DATABASE_ROUTES) },
      { path: 'kkm',
        canActivate: [RoleGuard],
        data: { roles: [Role.DEVELOPER] },
        loadChildren: () => import('./kkm/kkm.routes').then(m => m.KKM_ROUTES) },
      { path: 'settings', loadChildren: () => import('./settings/settings.routes').then(m => m.SETTINGS_ROUTES) }
    ]
  }
];
