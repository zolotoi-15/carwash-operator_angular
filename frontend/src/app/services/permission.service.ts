import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { Permission, PermissionMatrix } from '../models/permission.model';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/action.enum';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/permissions`;

  getMatrix(): Observable<PermissionMatrix> {
    if (environment.useMockAuth) return of({});
    return this.http.get<PermissionMatrix>(`${this.api}/matrix`);
  }

  getByGroup(gid: number): Observable<Permission[]> {
    if (environment.useMockAuth) {
      // Для оператора (groupId=3) — только чтение дашборда/отчётов/карт
      if (gid === 3) {
        return of([
          { id: 1, groupId: 3, resource: ResourceType.Dashboard,   actions: [PermissionAction.Read] },
          { id: 2, groupId: 3, resource: ResourceType.Reports,     actions: [PermissionAction.Read] },
          { id: 3, groupId: 3, resource: ResourceType.ClientCards, actions: [PermissionAction.Read] }
        ]);
      }
      // Для остальных — пусто (админ/dev всё и так видят)
      return of([]);
    }
    return this.http.get<Permission[]>(`${this.api}/group/${gid}`);
  }

  updateForGroup(gid: number, p: Permission[]): Observable<Permission[]> {
    if (environment.useMockAuth) {
      console.log('🧪 MOCK save permissions for group', gid, p);
      return of(p);
    }
    return this.http.put<Permission[]>(`${this.api}/group/${gid}`, { permissions: p });
  }
}