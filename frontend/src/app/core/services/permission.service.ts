import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Permission, PermissionMatrix } from '../models/permission.model';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/action.enum';

const MOCK: { [groupId: number]: Permission[] } = {
  1: Object.values(ResourceType).map((r, i) => ({
    id: i + 1, groupId: 1, resource: r,
    actions: [PermissionAction.Read, PermissionAction.Write,
              PermissionAction.Update, PermissionAction.Delete]
  })),
  3: [
    { id: 1, groupId: 3, resource: ResourceType.Dashboard,   actions: [PermissionAction.Read] },
    { id: 2, groupId: 3, resource: ResourceType.Reports,     actions: [PermissionAction.Read] },
    { id: 3, groupId: 3, resource: ResourceType.ClientCards, actions: [PermissionAction.Read] }
  ]
};

@Injectable({ providedIn: 'root' })
export class PermissionService {
  getMatrix(): Observable<PermissionMatrix> {
    const matrix: PermissionMatrix = {};
    Object.keys(MOCK).forEach(k => {
      const groupId = Number(k);
      matrix[groupId] = {};
      MOCK[groupId].forEach(p => matrix[groupId][p.resource] = p.actions);
    });
    return of(matrix);
  }

  getByGroup(groupId: number): Observable<Permission[]> {
    console.log('🧪 MOCK permissions group', groupId);
    return of(MOCK[groupId] ?? []);
  }

  updateForGroup(groupId: number, permissions: Permission[]): Observable<Permission[]> {
    console.log('🧪 MOCK save permissions group', groupId, permissions);
    MOCK[groupId] = permissions;
    return of(permissions);
  }
}