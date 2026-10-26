// src/app/features/client-cards/client-cards.routes.ts
import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { PermissionGuard } from '../../core/guards/permission.guard';
import { ResourceType } from '../../core/models/resource.enum';
import { PermissionAction } from '../../core/models/action.enum';

export const CLIENT_CARDS_ROUTES: Routes = [
  {
    path: '',
    canActivate: [AuthGuard, PermissionGuard],
    data: { resource: ResourceType.ClientCards, action: PermissionAction.Read },
    loadComponent: () =>
      import('./card-list/card-list.component').then(m => m.CardListComponent),
  },
  {
    path: 'edit/:id',
    canActivate: [AuthGuard, PermissionGuard],
    data: { resource: ResourceType.ClientCards, action: PermissionAction.Update },
    loadComponent: () =>
      import('./card-form/card-form.component').then(m => m.CardFormComponent),
  },
  {
    path: 'delete/:id',
    canActivate: [AuthGuard, PermissionGuard],
    data: { resource: ResourceType.ClientCards, action: PermissionAction.Delete },
    loadComponent: () =>
      import('./card-delete/card-delete.component').then(m => m.CardDeleteComponent),
  },
];