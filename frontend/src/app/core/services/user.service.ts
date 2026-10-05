import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User, CreateUserDto } from '../models/user.model';
import { Role } from '../models/role.enum';

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/users`;

  private mockUsers: User[] = [
    {
      id: 1, username: 'admin', name: 'Администратор',
      fullName: 'Администратор Системы',
      email: 'admin@carwash.local', groupId: 1,
      group: { id: 1, name: Role.ADMINISTRATOR, displayName: 'Администратор' }
    },
    {
      id: 2, username: 'dev', name: 'Разработчик',
      fullName: 'Разработчик Системы',
      email: 'dev@carwash.local', groupId: 2,
      group: { id: 2, name: Role.DEVELOPER, displayName: 'Разработчик' }
    },
    {
      id: 3, username: 'operator', name: 'Оператор',
      fullName: 'Оператор Смены',
      email: 'operator@carwash.local', groupId: 3,
      group: { id: 3, name: Role.OPERATOR, displayName: 'Оператор' }
    }
  ];

  getUsers(): Observable<User[]> {
    return of(this.mockUsers);
    // return this.http.get<User[]>(this.apiUrl);
  }

  getUser(id: number): Observable<User> {
    return of(this.mockUsers.find(u => u.id === id)!);
    // return this.http.get<User>(`${this.apiUrl}/${id}`);
  }

  createUser(dto: CreateUserDto): Observable<User> {
    const newUser: User = {
      id: this.mockUsers.length + 1,
      username: dto.username,
      name: dto.fullName,
      fullName: dto.fullName,
      email: dto.email,
      groupId: dto.groupId
    };
    this.mockUsers.push(newUser);
    return of(newUser);
    // return this.http.post<User>(this.apiUrl, dto);
  }

  updateUser(id: number, dto: Partial<CreateUserDto>): Observable<User> {
    const idx = this.mockUsers.findIndex(u => u.id === id);
    this.mockUsers[idx] = { ...this.mockUsers[idx], ...dto } as User;
    return of(this.mockUsers[idx]);
    // return this.http.put<User>(`${this.apiUrl}/${id}`, dto);
  }

  deleteUser(id: number): Observable<void> {
    this.mockUsers = this.mockUsers.filter(u => u.id !== id);
    return of(void 0);
    // return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}