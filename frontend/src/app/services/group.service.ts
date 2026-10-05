import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { Group, CreateGroupDto } from '../models/group.model';
import { Role } from '../models/role.enum';
import { environment } from '../../../environments/environment';

const MOCK_GROUPS: Group[] = [
  { id: 1, name: Role.ADMINISTRATOR, displayName: 'Администратор',
    description: 'Полный доступ ко всем настройкам', isSystem: true, userCount: 1 },
  { id: 2, name: Role.DEVELOPER, displayName: 'Разработчик',
    description: 'Полный доступ + БД/ККМ/Права', isSystem: true, userCount: 1 },
  { id: 3, name: Role.OPERATOR, displayName: 'Оператор',
    description: 'Ограниченный доступ', isSystem: true, userCount: 1 }
];

@Injectable({ providedIn: 'root' })
export class GroupService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/groups`;

  getGroups(): Observable<Group[]> {
    if (environment.useMockAuth) {
      console.log('🧪 MOCK groups');
      return of(MOCK_GROUPS);
    }
    return this.http.get<Group[]>(this.api);
  }

  getGroup(id: number): Observable<Group> {
    if (environment.useMockAuth) {
      const g = MOCK_GROUPS.find(x => x.id === id)!;
      return of(g);
    }
    return this.http.get<Group>(`${this.api}/${id}`);
  }

  createGroup(d: CreateGroupDto): Observable<Group> {
    if (environment.useMockAuth) {
      const g: Group = { id: Date.now(), ...d, isSystem: false, userCount: 0 };
      MOCK_GROUPS.push(g);
      return of(g);
    }
    return this.http.post<Group>(this.api, d);
  }

  updateGroup(id: number, d: Partial<CreateGroupDto>): Observable<Group> {
    if (environment.useMockAuth) {
      const g = MOCK_GROUPS.find(x => x.id === id)!;
      Object.assign(g, d);
      return of(g);
    }
    return this.http.put<Group>(`${this.api}/${id}`, d);
  }

  deleteGroup(id: number): Observable<void> {
    if (environment.useMockAuth) {
      const i = MOCK_GROUPS.findIndex(x => x.id === id);
      if (i >= 0) MOCK_GROUPS.splice(i, 1);
      return of(void 0);
    }
    return this.http.delete<void>(`${this.api}/${id}`);
  }
}