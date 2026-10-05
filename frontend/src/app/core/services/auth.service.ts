// src/app/core/services/auth.service.ts
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, of, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';
import { Role } from '../models/role.enum';

interface LoginCredentials {
  username: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  // ================= STATE (Signals) =================
  private readonly currentUser = signal<User | null>(null);
  private readonly token = signal<string | null>(null);

  // ================= PUBLIC SELECTORS =================
  readonly currentUser$ = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly userRole = computed<Role | null>(() => this.currentUser()?.group?.name ?? null);
  readonly isDeveloper = computed(() => this.userRole() === Role.DEVELOPER);
  readonly isAdministrator = computed(() =>
    this.userRole() === Role.ADMINISTRATOR || this.userRole() === Role.DEVELOPER
  );

  // ================= MOCK USERS (для разработки) =================
  private readonly mockUsers: Array<{ username: string; password: string; user: User }> = [
    {
      username: 'admin',
      password: 'admin',
      user: {
        id: 1,
        name: 'Администратор',
        email: 'admin@carwash.local',
        group: { id: 1, name: Role.ADMINISTRATOR, displayName: 'Администратор' }
      }
    },
    {
      username: 'dev',
      password: 'dev',
      user: {
        id: 2,
        name: 'Разработчик',
        email: 'dev@carwash.local',
        group: { id: 2, name: Role.DEVELOPER, displayName: 'Разработчик' }
      }
    },
    {
      username: 'operator',
      password: 'operator',
      user: {
        id: 3,
        name: 'Оператор',
        email: 'operator@carwash.local',
        group: { id: 3, name: Role.OPERATOR, displayName: 'Оператор' }
      }
    }
  ];
  // ===============================================================

  // ================= PUBLIC API =================

  login(credentials: LoginCredentials): Observable<LoginResponse> {
    // --- ЗАГЛУШКА: замените на реальный http.post, когда API будет готов ---
    const found = this.mockUsers.find(
      m => m.username === credentials.username && m.password === credentials.password
    );

    if (!found) {
      return throwError(() => new Error('Неверный логин или пароль'));
    }

    const response: LoginResponse = {
      token: 'mock-token-' + found.user.id,
      user: found.user
    };

    return of(response).pipe(
      tap(res => this.setSession(res))
    );

    // --- РЕАЛЬНЫЙ ВАРИАНТ ---
    // return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, credentials).pipe(
    //   tap(res => this.setSession(res))
    // );
  }

  logout(): void {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  restoreSession(): void {
    const token = localStorage.getItem(environment.tokenKey);
    const userJson = localStorage.getItem(environment.tokenKey + '_user');

    if (!token || !userJson) return;

    try {
      const user = JSON.parse(userJson) as User;
      this.token.set(token);
      this.currentUser.set(user);
    } catch {
      this.clearSession();
    }
  }

  getToken(): string | null {
    return this.token();
  }

  // ================= ROLE HELPERS =================

  hasRole(role: Role): boolean {
    return this.currentUser()?.group?.name === role;
  }

  hasAnyRole(roles: Role[]): boolean {
    const current = this.currentUser()?.group?.name;
    return !!current && roles.includes(current);
  }

  hasDeveloperAccess(): boolean {
    return this.hasRole(Role.DEVELOPER);
  }

  hasAdminAccess(): boolean {
    return this.hasAnyRole([Role.ADMINISTRATOR, Role.DEVELOPER]);
  }

  // ================= PRIVATE =================

  private setSession(res: LoginResponse): void {
    this.token.set(res.token);
    this.currentUser.set(res.user);
    localStorage.setItem(environment.tokenKey, res.token);
    localStorage.setItem(environment.tokenKey + '_user', JSON.stringify(res.user));
  }

  private clearSession(): void {
    this.token.set(null);
    this.currentUser.set(null);
    localStorage.removeItem(environment.tokenKey);
    localStorage.removeItem(environment.tokenKey + '_user');
  }
}