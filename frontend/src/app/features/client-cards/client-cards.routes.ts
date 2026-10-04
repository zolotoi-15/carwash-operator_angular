import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { RoleGuard } from '../../core/guards/role.guard';
import { PermissionGuard } from '../../core/guards/permission.guard';
import { ResourceType } from '../../core/models/resource.enum';
import { PermissionAction } from '../../core/models/action.enum';
import { Role } from '../../core/models/role.enum';

export const CLIENT_CARDS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./card-list/card-list.component').then(m => m.CardListComponent),
    canActivate: [AuthGuard, PermissionGuard], data: { resource: ResourceType.ClientCards, action: PermissionAction.Read } },
  { path: 'edit/:id', loadComponent: () => import('./card-form/card-form.component').then(m => m.CardFormComponent),
    canActivate: [AuthGuard, RoleGuard, PermissionGuard],
    data: { roles: [Role.Administrator, Role.Developer], resource: ResourceType.ClientCards, action: PermissionAction.Update } },
  { path: 'delete/:id', loadComponent: () => import('./card-delete/card-delete.component').then(m => m.CardDeleteComponent),
    canActivate: [AuthGuard, RoleGuard, PermissionGuard],
    data: { roles: [Role.Administrator, Role.Developer], resource: ResourceType.ClientCards, action: PermissionAction.Delete } }
];
