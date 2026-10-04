import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Group, CreateGroupDto } from '../models/group.model';
import { Role } from '../models/role.enum';

const MOCK_GROUPS: Group[] = [
  { id: 1, name: Role.Administrator, displayName: 'Администратор',
    description: 'Полный доступ', isSystem: true, userCount: 1 },
  { id: 2, name: Role.Developer, displayName: 'Разработчик',
    description: 'Полный доступ + БД/ККМ', isSystem: true, userCount: 1 },
  { id: 3, name: Role.Operator, displayName: 'Оператор',
    description: 'Ограниченный доступ', isSystem: true, userCount: 1 }
];

@Injectable({ providedIn: 'root' })
export class GroupService {
  getGroups(): Observable<Group[]> {
    console.log('🧪 MOCK groups getGroups()');
    return of([...MOCK_GROUPS]);
  }
  getGroup(id: number): Observable<Group> {
    console.log('🧪 MOCK groups getGroup()', id);
    return of(MOCK_GROUPS.find(x => x.id === id)!);
  }
  createGroup(d: CreateGroupDto): Observable<Group> {
    console.log('🧪 MOCK groups createGroup()', d);
    const g: Group = { id: Date.now(), ...d, isSystem: false, userCount: 0 };
    MOCK_GROUPS.push(g);
    return of(g);
  }
  updateGroup(id: number, d: Partial<CreateGroupDto>): Observable<Group> {
    console.log('🧪 MOCK groups updateGroup()', id, d);
    const g = MOCK_GROUPS.find(x => x.id === id)!;
    Object.assign(g, d);
    return of(g);
  }
  deleteGroup(id: number): Observable<void> {
    console.log('🧪 MOCK groups deleteGroup()', id);
    const i = MOCK_GROUPS.findIndex(x => x.id === id);
    if (i >= 0) MOCK_GROUPS.splice(i, 1);
    return of(void 0);
  }
}