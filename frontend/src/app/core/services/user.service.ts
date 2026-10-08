// src/app/core/services/user.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type UserRole = 'admin' | 'developer' | 'operator';

export interface AppUser {
  _id: string;
  login: string;
  fullName: string;
  email: string;
  role: UserRole;
  group: string;
  isActive: boolean;
  createdAt?: string;
}

export interface CreateUserDto {
  login: string;
  password: string;
  fullName?: string;
  email?: string;
  role: UserRole;
}

export interface UpdateUserDto {
  fullName?: string;
  email?: string;
  role?: UserRole;
  password?: string;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/users`;

  // ==================== Основной API ====================

  /** GET /api/users */
  list(): Observable<AppUser[]> {
    return this.http.get<AppUser[]>(this.apiUrl);
  }

  /** POST /api/users */
  create(dto: CreateUserDto): Observable<AppUser> {
    return this.http.post<AppUser>(this.apiUrl, dto);
  }

  /** PATCH /api/users/:id */
  update(id: string, dto: UpdateUserDto): Observable<AppUser> {
    return this.http.patch<AppUser>(`${this.apiUrl}/${id}`, dto);
  }

  /** DELETE /api/users/:id */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  // ==================== Legacy-алиасы ====================
  // Нужны, чтобы старые компоненты (user-form.component.ts) компилировались
  // без изменений. Со временем их лучше удалить, а компоненты переписать
  // на list/create/update/remove.

  /** Legacy: получить пользователя по id (через list + filter). */
  getUser(id: number | string): Observable<AppUser> {
    const idStr = String(id);
    return this.list().pipe(
      map((users) => {
        const found = users.find((u) => u._id === idStr);
        if (!found) {
          throw new Error(`Пользователь ${idStr} не найден`);
        }
        return found;
      }),
    );
  }

  /** Legacy: создать пользователя. */
  createUser(dto: CreateUserDto): Observable<AppUser> {
    return this.create(dto);
  }

  /** Legacy: обновить пользователя. */
  updateUser(id: number | string, dto: UpdateUserDto): Observable<AppUser> {
    return this.update(String(id), dto);
  }
}