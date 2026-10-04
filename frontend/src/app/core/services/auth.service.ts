<<<<<<< Updated upstream
﻿import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of, tap, delay } from 'rxjs';
import { User, LoginDto, LoginResponse } from '../models/user.model';
import { Permission } from '../models/permission.model';
import { Role } from '../models/role.enum';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/action.enum';
import { StorageService } from './storage.service';
import { environment } from '../../../environments/environment';

const TOKEN_KEY = 'cw_token';
const USER_KEY = 'cw_user';
const PERMS_KEY = 'cw_permissions';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private storage = inject(StorageService);

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private permissionsSubject = new BehaviorSubject<Permission[]>([]);
  public permissions$ = this.permissionsSubject.asObservable();

  get currentUser(): User | null { return this.currentUserSubject.value; }
  get token(): string | null { return this.storage.get<string>(TOKEN_KEY); }

  // ================= MOCK USERS =================
  private mockUsers: Record<string, { password: string; user: User; permissions: Permission[] }> = {
    admin: {
      password: 'admin',
      user: {
        id: 1, username: 'admin', email: 'admin@cw.ru', fullName: 'Администратор',
        groupId: 1, isActive: true,
        group: { id: 1, name: Role.Administrator, displayName: 'Администратор',
                 description: 'Полный доступ', isSystem: true }
      },
      permissions: Object.values(ResourceType).map((r, i) => ({
        id: i + 1, groupId: 1, resource: r,
        actions: [PermissionAction.Read, PermissionAction.Write,
                  PermissionAction.Update, PermissionAction.Delete]
      }))
    },
    dev: {
      password: 'dev',
      user: {
        id: 2, username: 'dev', email: 'dev@cw.ru', fullName: 'Разработчик',
        groupId: 2, isActive: true,
        group: { id: 2, name: Role.Developer, displayName: 'Разработчик',
                 description: 'Полный доступ + БД/ККМ', isSystem: true }
      },
      permissions: []
    },
    operator: {
      password: 'operator',
      user: {
        id: 3, username: 'operator', email: 'op@cw.ru', fullName: 'Оператор',
        groupId: 3, isActive: true,
        group: { id: 3, name: Role.Operator, displayName: 'Оператор',
                 description: 'Ограниченный доступ', isSystem: true }
      },
      permissions: [
        { id: 1, groupId: 3, resource: ResourceType.Dashboard,   actions: [PermissionAction.Read] },
        { id: 2, groupId: 3, resource: ResourceType.Reports,     actions: [PermissionAction.Read] },
        { id: 3, groupId: 3, resource: ResourceType.ClientCards, actions: [PermissionAction.Read] }
      ]
    }
  };
  // ===============================================

  restoreSession(): void {
    const u = this.storage.get<User>(USER_KEY);
    const p = this.storage.get<Permission[]>(PERMS_KEY) ?? [];
    if (u) {
      this.currentUserSubject.next(u);
      this.permissionsSubject.next(p);
    }
  }

  login(dto: LoginDto): Observable<LoginResponse> {
    // === ВЕТКА MOCK ===
    if (environment.useMockAuth) {
      const match = this.mockUsers[dto.username];
      const ok = match && match.password === dto.password;
      const result: LoginResponse | null = ok ? {
        token: 'mock-' + dto.username + '-' + Date.now(),
        user: match.user,
        permissions: match.permissions
      } : null;

      return new Observable<LoginResponse>(sub => {
        setTimeout(() => {
          if (result) {
            this.applyLogin(result);
            console.log('✅ MOCK login OK:', dto.username, match.user.group?.name);
            sub.next(result);
            sub.complete();
          } else {
            console.warn('❌ MOCK login FAIL:', dto.username);
            sub.error(new Error('Неверные данные'));
          }
        }, 300);
      });
    }

    // === ВЕТКА HTTP ===
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, dto).pipe(
      tap(res => this.applyLogin(res))
    );
  }

  private applyLogin(res: LoginResponse): void {
    this.storage.set(TOKEN_KEY, res.token);
    this.storage.set(USER_KEY, res.user);
    this.storage.set(PERMS_KEY, res.permissions);
    this.currentUserSubject.next(res.user);
    this.permissionsSubject.next(res.permissions);
  }

  logout(): void {
    this.storage.remove(TOKEN_KEY);
    this.storage.remove(USER_KEY);
    this.storage.remove(PERMS_KEY);
    this.currentUserSubject.next(null);
    this.permissionsSubject.next([]);
    this.router.navigate(['/login']);
  }

  hasRole(role: Role): boolean { return this.currentUser?.group?.name === role; }
  hasAnyRole(roles: Role[]): boolean {
    const r = this.currentUser?.group?.name;
    return r ? roles.includes(r) : false;
  }
  hasPermission(resource: ResourceType, action: PermissionAction): boolean {
    const u = this.currentUser;
    if (!u) return false;
    if (u.group?.name === Role.Developer) return true;
    const p = this.permissionsSubject.value.find(x => x.resource === resource);
    return p ? p.actions.includes(action) : false;
=======
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { User } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      this.currentUserSubject.next(JSON.parse(stored));
    }
  }

  get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  login(user: User): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  logout(): void {
    localStorage.removeItem('currentUser');
    this.currentUserSubject.next(null);
  }

  hasRole(groupName: string): boolean {
    const user = this.currentUserValue;
    if (!user) return false;
    // Здесь должна быть логика получения группы пользователя.
    // Для примера считаем, что groupId соответствует GroupType.
    return user.groupId === this.mapGroupNameToId(groupName);
  }

  private mapGroupNameToId(groupName: string): number {
    // В реальном приложении — запрос к сервису групп
    const map: Record<string, number> = {
      'administrator': 1,
      'developer': 2,
      'operator': 3
    };
    return map[groupName] || 0;
>>>>>>> Stashed changes
  }
}