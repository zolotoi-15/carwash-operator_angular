import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Permission, PermissionAction } from '../models/permission.model';
import { ResourceType } from '../models/resource.enum';

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/permissions`;

  // MOCK — удалить после подключения реального API
  private mockPermissions: Permission[] = [
    {
      id: 1, groupId: 1,
      resource: ResourceType.Dashboard,
      actions: [PermissionAction.Read, PermissionAction.Write, PermissionAction.Update]
    },
    {
      id: 2, groupId: 2,
      resource: ResourceType.Dashboard,
      actions: [
        PermissionAction.Read,
        PermissionAction.Write,
        PermissionAction.Update,
        PermissionAction.Delete
      ]
    },
    {
      id: 3, groupId: 3,
      resource: ResourceType.Dashboard,
      actions: [PermissionAction.Read]
    }
  ];

  getByGroup(groupId: number): Observable<Permission[]> {
    return of(this.mockPermissions.filter(p => p.groupId === groupId));
    // REAL: return this.http.get<Permission[]>(`${this.apiUrl}/group/${groupId}`);
  }

  updateForGroup(groupId: number, permissions: Permission[]): Observable<Permission[]> {
    this.mockPermissions = this.mockPermissions.filter(p => p.groupId !== groupId);
    this.mockPermissions.push(...permissions);
    return of(permissions);
    // REAL: return this.http.put<Permission[]>(`${this.apiUrl}/group/${groupId}`, permissions);
  }

  hasPermission(groupId: number, resource: ResourceType, action: PermissionAction): boolean {
    const perm = this.mockPermissions.find(
      p => p.groupId === groupId && p.resource === resource
    );
    return perm ? perm.actions.includes(action) : false;
  }
}