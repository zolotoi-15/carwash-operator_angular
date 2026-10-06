// frontend/src/app/core/services/user.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

  /** GET /api/users — список пользователей */
  list(): Observable<AppUser[]> {
    return this.http.get<AppUser[]>(this.apiUrl);
  }

  /** POST /api/users — создать пользователя */
  create(dto: CreateUserDto): Observable<AppUser> {
    return this.http.post<AppUser>(this.apiUrl, dto);
  }

  /** PATCH /api/users/:id — обновить */
  update(id: string, dto: UpdateUserDto): Observable<AppUser> {
    return this.http.patch<AppUser>(`${this.apiUrl}/${id}`, dto);
  }

  /** DELETE /api/users/:id */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}