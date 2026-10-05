import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { User, CreateUserDto, UpdateUserDto } from '../models/user.model';
import { Role } from '../models/role.enum';
import { environment } from '../../../environments/environment';

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
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/users`;

 getUsers(): Observable<User[]> {
  console.log('🧪 MOCK users called');
  return of(MOCK_USERS);
}

  getUser(id: number): Observable<User> {
    if (environment.useMockAuth) {
      return of(MOCK_USERS.find(x => x.id === id)!);
    }
    return this.http.get<User>(`${this.api}/${id}`);
  }

  createUser(d: CreateUserDto): Observable<User> {
    if (environment.useMockAuth) {
      const u: User = { id: Date.now(), ...d } as User;
      MOCK_USERS.push(u);
      return of(u);
    }
    return this.http.post<User>(this.api, d);
  }

  updateUser(id: number, d: UpdateUserDto): Observable<User> {
    if (environment.useMockAuth) {
      const u = MOCK_USERS.find(x => x.id === id)!;
      Object.assign(u, d);
      return of(u);
    }
    return this.http.put<User>(`${this.api}/${id}`, d);
  }

  deleteUser(id: number): Observable<void> {
    if (environment.useMockAuth) {
      const i = MOCK_USERS.findIndex(x => x.id === id);
      if (i >= 0) MOCK_USERS.splice(i, 1);
      return of(void 0);
    }
    return this.http.delete<void>(`${this.api}/${id}`);
  }
}