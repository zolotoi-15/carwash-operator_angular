import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';
import { Role } from '../models/role.enum';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/permission.model';

interface LoginCredentials { username: string; password: string; }
interface LoginResponse { token: string; user: User; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  // ===== STATE =====
  private readonly currentUser = signal<User | null>(null);
  private readonly tokenSignal = signal<string | null>(null);

  // ===== PUBLIC SELECTORS =====
  readonly currentUser$ = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly userRole = computed<Role | null>(
    () => this.currentUser()?.group?.name ?? null
  );
  readonly isDeveloper = computed(() => this.userRole() === Role.DEVELOPER);
  readonly isAdministrator = computed(() =>
    this.userRole() === Role.ADMINISTRATOR || this.userRole() === Role.DEVELOPER
  );

  // ===== MOCK USERS (удалить после подключения API) =====
  private readonly mockUsers = [
    {
      username: 'admin', password: 'admin',
      user: {
        id: 1, username: 'admin', name: 'Администратор',
        fullName: 'Администратор Системы',
        email: 'admin@carwash.local', groupId: 1,
        group: { id: 1, name: Role.ADMINISTRATOR, displayName: 'Администратор' }
      } as User
    },
    {
      username: 'dev', password: 'dev',
      user: {
        id: 2, username: 'dev', name: 'Разработчик',
        fullName: 'Разработчик Системы',
        email: 'dev@carwash.local', groupId: 2,
        group: { id: 2, name: Role.DEVELOPER, displayName: 'Разработчик' }
      } as User
    },
    {
      username: 'operator', password: 'operator',
      user: {
        id: 3, username: 'operator', name: 'Оператор',
        fullName: 'Оператор Смены',
        email: 'operator@carwash.local', groupId: 3,
        group: { id: 3, name: Role.OPERATOR, displayName: 'Оператор' }
      } as User
    }
  ];

  // ===== PUBLIC API =====
  login(credentials: LoginCredentials): Observable<LoginResponse> {
    const found = this.mockUsers.find(
      m => m.username === credentials.username && m.password === credentials.password
    );
    if (!found) return throwError(() => new Error('Неверный логин или пароль'));

    const response: LoginResponse = {
      token: 'mock-token-' + found.user.id,
      user: found.user
    };
    return of(response).pipe(tap(res => this.setSession(res)));

    // REAL:
    // return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, credentials)
    //   .pipe(tap(res => this.setSession(res)));
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

  // ===== GETTERS (для гардов и интерцепторов) =====
  get currentUserValue(): User | null { return this.currentUser(); }
  getToken(): string | null { return this.tokenSignal(); }
  get token(): string | null { return this.tokenSignal(); }   // на случай прямого доступа

  // ===== ROLE HELPERS =====
  hasRole(role: Role): boolean { return this.userRole() === role; }

  hasAnyRole(roles: Role[]): boolean {
    const current = this.userRole();
    return !!current && roles.includes(current);
  }

  hasDeveloperAccess(): boolean { return this.hasRole(Role.DEVELOPER); }

  hasAdminAccess(): boolean {
    return this.hasAnyRole([Role.ADMINISTRATOR, Role.DEVELOPER]);
  }

  hasPermission(_resource: ResourceType, _action: PermissionAction): boolean {
    // TODO: подключить PermissionService
    const role = this.userRole();
    if (role === Role.DEVELOPER) return true;
    if (role === Role.ADMINISTRATOR) return true;
    if (role === Role.OPERATOR) return _action === PermissionAction.Read;
    return false;
  }

  // ===== PRIVATE =====
  private setSession(res: LoginResponse): void {
    this.tokenSignal.set(res.token);
    this.currentUser.set(res.user);
    localStorage.setItem(environment.tokenKey, res.token);
    localStorage.setItem(environment.tokenKey + '_user', JSON.stringify(res.user));
  }

  private clearSession(): void {
    this.tokenSignal.set(null);
    this.currentUser.set(null);
    localStorage.removeItem(environment.tokenKey);
    localStorage.removeItem(environment.tokenKey + '_user');
  }
}