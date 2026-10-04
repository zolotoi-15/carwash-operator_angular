import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Permission, PermissionAction, ResourceType } from '../models/permission.model';

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private permissionsSubject = new BehaviorSubject<Permission[]>([]);
  public permissions$ = this.permissionsSubject.asObservable();

  constructor() {}

  loadPermissions(groupId: number): void {
    // Запрос к API: /api/permissions?groupId=...
    // Для примера — заглушка
    const mock: Permission[] = [
      { id: 1, groupId: 1, resource: ResourceType.Dashboard, actions: [PermissionAction.Read, PermissionAction.Write, PermissionAction.Update, PermissionAction.Delete] },
      // ... остальные права
    ];
    this.permissionsSubject.next(mock);
  }

  hasPermission(resource: ResourceType, action: PermissionAction): boolean {
    const userGroupId = 0; // Получите из AuthService
    const perms = this.permissionsSubject.value;
    const perm = perms.find(p => p.groupId === userGroupId && p.resource === resource);
    return perm ? perm.actions.includes(action) : false;
  }
}