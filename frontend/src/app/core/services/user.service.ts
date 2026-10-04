import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { User, CreateUserDto, UpdateUserDto } from '../models/user.model';
import { Role } from '../models/role.enum';

const MOCK_USERS: User[] = [
  { id: 1, username: 'admin', email: 'admin@cw.ru', fullName: 'Администратор',
    groupId: 1, isActive: true,
    group: { id: 1, name: Role.Administrator, displayName: 'Администратор',
             description: '', isSystem: true } },
  { id: 2, username: 'dev', email: 'dev@cw.ru', fullName: 'Разработчик',
    groupId: 2, isActive: true,
    group: { id: 2, name: Role.Developer, displayName: 'Разработчик',
             description: '', isSystem: true } },
  { id: 3, username: 'operator', email: 'op@cw.ru', fullName: 'Оператор',
    groupId: 3, isActive: true,
    group: { id: 3, name: Role.Operator, displayName: 'Оператор',
             description: '', isSystem: true } }
];

@Injectable({ providedIn: 'root' })
export class UserService {
  getUsers(): Observable<User[]> {
    console.log('🧪 MOCK users getUsers()');
    return of([...MOCK_USERS]);
  }
  getUser(id: number): Observable<User> {
    console.log('🧪 MOCK users getUser()', id);
    return of(MOCK_USERS.find(x => x.id === id)!);
  }
  createUser(d: CreateUserDto): Observable<User> {
    console.log('🧪 MOCK users createUser()', d);
    const u: User = { id: Date.now(), ...d, isActive: true, groupId: d.groupId ?? 3 } as User;
    MOCK_USERS.push(u);
    return of(u);
  }
  updateUser(id: number, d: UpdateUserDto): Observable<User> {
    console.log('🧪 MOCK users updateUser()', id, d);
    const u = MOCK_USERS.find(x => x.id === id)!;
    Object.assign(u, d);
    return of(u);
  }
  deleteUser(id: number): Observable<void> {
    console.log('🧪 MOCK users deleteUser()', id);
    const i = MOCK_USERS.findIndex(x => x.id === id);
    if (i >= 0) MOCK_USERS.splice(i, 1);
    return of(void 0);
  }
}