import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, map, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';
import { Role } from '../models/role.enum';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/permission.model';

// ============================================================
// Типы
// ============================================================

interface LoginCredentials {
  username: string;
  password: string;
}

/** То, что возвращает бэкенд (server.js → POST /api/login) */
interface LoginResponse {
  token: string;
  role: string;              // 'admin' | 'operator' | 'developer' | ...
}

/** То, что использует приложение */
interface AuthSession {
  token: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private readonly currentUser = signal<User | null>(null);
  private readonly tokenSignal = signal<string | null>(null);

  readonly currentUser$ = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly userRole = computed<Role | null>(() => this.currentUser()?.group?.name ?? null);
  readonly isDeveloper = computed(() => this.userRole() === Role.DEVELOPER);
  readonly isAdministrator = computed(() =>
    this.userRole() === Role.ADMINISTRATOR || this.userRole() === Role.DEVELOPER);

  constructor() {
    this.restoreSession();
  }

  // ============================================================
  // Логин — реальный запрос к бэкенду
  // ============================================================
  login(credentials: LoginCredentials): Observable<AuthSession> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/login`, credentials)
      .pipe(
        map(res => {
          if (!res?.token) {
            throw new Error('Сервер не вернул токен');
          }

          const user: User = {
            id: 0,
            username: credentials.username,
            name: credentials.username,
            fullName: credentials.username,
            email: '',
            groupId: 0,
            group: {
              id: 0,
              name: this.mapRole(res.role),
              displayName: this.roleDisplayName(res.role),
            },
          };

          const session: AuthSession = { token: res.token, user };
          this.setSession(session);
          return session;
        }),
        catchError(err => {
          console.error('[AuthService] login failed:', err);
          return throwError(() => new Error(
            err?.error?.error || 'Неверный логин или пароль'
          ));
        })
      );
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
      this.tokenSignal.set(token);
      this.currentUser.set(JSON.parse(userJson) as User);
    } catch {
      this.clearSession();
    }
  }

  get currentUserValue(): User | null {
    return this.currentUser();
  }

  getToken(): string | null {
    return this.tokenSignal();
  }

  get token(): string | null {
    return this.tokenSignal();
  }

  hasRole(role: Role): boolean {
    return this.userRole() === role;
  }

  hasAnyRole(roles: Role[]): boolean {
    const c = this.userRole();
    return !!c && roles.includes(c);
  }

  hasDeveloperAccess(): boolean {
    return this.hasRole(Role.DEVELOPER);
  }

  hasAdminAccess(): boolean {
    return this.hasAnyRole([Role.ADMINISTRATOR, Role.DEVELOPER]);
  }

  hasPermission(_resource: ResourceType, action: PermissionAction): boolean {
    const role = this.userRole();
    if (role === Role.DEVELOPER) return true;
    if (role === Role.ADMINISTRATOR) return action !== PermissionAction.Delete;
    if (role === Role.OPERATOR) return action === PermissionAction.Read;
    return false;
  }

  // ============================================================
  // Приватное
  // ============================================================
  private setSession(session: AuthSession): void {
    this.tokenSignal.set(session.token);
    this.currentUser.set(session.user);
    localStorage.setItem(environment.tokenKey, session.token);
    localStorage.setItem(environment.tokenKey + '_user', JSON.stringify(session.user));
  }

  private clearSession(): void {
    this.tokenSignal.set(null);
    this.currentUser.set(null);
    localStorage.removeItem(environment.tokenKey);
    localStorage.removeItem(environment.tokenKey + '_user');
  }

  /** backend шлёт 'admin' | 'operator' | 'developer' — приводим к enum Role */
  private mapRole(role: string): Role {
    const r = (role || '').toLowerCase();
    if (r === 'admin' || r === 'administrator') return Role.ADMINISTRATOR;
    if (r === 'developer' || r === 'dev') return Role.DEVELOPER;
    if (r === 'operator') return Role.OPERATOR;
    return Role.OPERATOR;
  }

  private roleDisplayName(role: string): string {
    const r = (role || '').toLowerCase();
    if (r === 'admin' || r === 'administrator') return 'Администратор';
    if (r === 'developer' || r === 'dev') return 'Разработчик';
    if (r === 'operator') return 'Оператор';
    return 'Пользователь';
  }
}