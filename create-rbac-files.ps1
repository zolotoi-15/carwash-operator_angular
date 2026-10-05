$ErrorActionPreference = "Stop"
$base = "C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\frontend\src\app"

# ---- 1. Директории ----
$dirs = @(
  "core\guards","core\interceptors","core\models","core\services","core\constants",
  "shared\components\header","shared\components\sidebar","shared\components\unauthorized",
  "shared\directives",
  "features\auth\login","features\auth\logout",
  "features\dashboard","features\reports\report-list",
  "features\client-cards\card-list","features\client-cards\card-form","features\client-cards\card-delete",
  "features\admin\users\user-list","features\admin\users\user-form",
  "features\admin\groups\group-list",
  "features\admin\permissions\permission-editor",
  "features\admin\database\database-backup",
  "features\admin\kkm\kkm-list",
  "features\admin\settings\general-settings"
)
$dirs | ForEach-Object { New-Item -ItemType Directory -Force -Path "$base\$_" | Out-Null }

Write-Host "✅ Директории созданы" -ForegroundColor Green

# ---- 2. Модели ----
@'
export enum Role { Administrator = 'administrator', Developer = 'developer', Operator = 'operator' }
'@ | Set-Content -Encoding UTF8 "$base\core\models\role.enum.ts"

@'
export enum ResourceType {
  Dashboard = 'dashboard', Reports = 'reports', ClientCards = 'client-cards',
  Users = 'users', Groups = 'groups', Permissions = 'permissions',
  Database = 'database', KKM = 'kkm', SystemSettings = 'system-settings'
}
'@ | Set-Content -Encoding UTF8 "$base\core\models\resource.enum.ts"

@'
export enum PermissionAction { Read = 'read', Write = 'write', Update = 'update', Delete = 'delete' }
'@ | Set-Content -Encoding UTF8 "$base\core\models\action.enum.ts"

@'
import { Role } from './role.enum';
export interface Group { id: number; name: Role; displayName: string; description: string; isSystem: boolean; userCount?: number; }
export interface CreateGroupDto { name: Role; displayName: string; description: string; }
'@ | Set-Content -Encoding UTF8 "$base\core\models\group.model.ts"

@'
import { Group } from './group.model';
import { Permission } from './permission.model';
export interface User { id: number; username: string; email: string; fullName: string; groupId: number; group?: Group; isActive: boolean; }
export interface CreateUserDto { username: string; email: string; password: string; fullName: string; groupId: number; isActive: boolean; }
export interface UpdateUserDto extends Partial<Omit<CreateUserDto,'password'>> { password?: string; }
export interface LoginDto { username: string; password: string; }
export interface LoginResponse { token: string; user: User; permissions: Permission[]; }
'@ | Set-Content -Encoding UTF8 "$base\core\models\user.model.ts"

@'
import { ResourceType } from './resource.enum';
import { PermissionAction } from './action.enum';
export interface Permission { id: number; groupId: number; resource: ResourceType; actions: PermissionAction[]; }
export interface PermissionMatrix { [groupId: number]: { [resource: string]: PermissionAction[] }; }
'@ | Set-Content -Encoding UTF8 "$base\core\models\permission.model.ts"

@'
import { ResourceType } from './resource.enum';
import { Role } from './role.enum';
export interface MenuItem { label: string; icon: string; route: string; resource?: ResourceType; allowedRoles?: Role[]; }
'@ | Set-Content -Encoding UTF8 "$base\core\models\menu-item.model.ts"

# ---- 3. Сервисы ----
@'
import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class StorageService {
  set<T>(k: string, v: T): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  get<T>(k: string): T | null { try { const i = localStorage.getItem(k); return i ? JSON.parse(i) : null; } catch { return null; } }
  remove(k: string): void { localStorage.removeItem(k); }
}
'@ | Set-Content -Encoding UTF8 "$base\core\services\storage.service.ts"

@'
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { User, LoginDto, LoginResponse } from '../models/user.model';
import { Permission } from '../models/permission.model';
import { Role } from '../models/role.enum';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/action.enum';
import { StorageService } from './storage.service';
import { environment } from '../../../environments/environment';

const TOKEN_KEY='cw_token', USER_KEY='cw_user', PERMS_KEY='cw_permissions';

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

  restoreSession(): void {
    const u = this.storage.get<User>(USER_KEY);
    const p = this.storage.get<Permission[]>(PERMS_KEY) ?? [];
    if (u) { this.currentUserSubject.next(u); this.permissionsSubject.next(p); }
  }

  login(dto: LoginDto): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, dto).pipe(
      tap(res => {
        this.storage.set(TOKEN_KEY, res.token);
        this.storage.set(USER_KEY, res.user);
        this.storage.set(PERMS_KEY, res.permissions);
        this.currentUserSubject.next(res.user);
        this.permissionsSubject.next(res.permissions);
      })
    );
  }

  logout(): void {
    this.storage.remove(TOKEN_KEY); this.storage.remove(USER_KEY); this.storage.remove(PERMS_KEY);
    this.currentUserSubject.next(null); this.permissionsSubject.next([]);
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
  }
}
'@ | Set-Content -Encoding UTF8 "$base\core\services\auth.service.ts"

@'
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User, CreateUserDto, UpdateUserDto } from '../models/user.model';
import { environment } from '../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/users`;
  getUsers(): Observable<User[]> { return this.http.get<User[]>(this.api); }
  getUser(id: number): Observable<User> { return this.http.get<User>(`${this.api}/${id}`); }
  createUser(d: CreateUserDto): Observable<User> { return this.http.post<User>(this.api, d); }
  updateUser(id: number, d: UpdateUserDto): Observable<User> { return this.http.put<User>(`${this.api}/${id}`, d); }
  deleteUser(id: number): Observable<void> { return this.http.delete<void>(`${this.api}/${id}`); }
}
'@ | Set-Content -Encoding UTF8 "$base\core\services\user.service.ts"

@'
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Group, CreateGroupDto } from '../models/group.model';
import { environment } from '../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class GroupService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/groups`;
  getGroups(): Observable<Group[]> { return this.http.get<Group[]>(this.api); }
  getGroup(id: number): Observable<Group> { return this.http.get<Group>(`${this.api}/${id}`); }
  createGroup(d: CreateGroupDto): Observable<Group> { return this.http.post<Group>(this.api, d); }
  updateGroup(id: number, d: Partial<CreateGroupDto>): Observable<Group> { return this.http.put<Group>(`${this.api}/${id}`, d); }
  deleteGroup(id: number): Observable<void> { return this.http.delete<void>(`${this.api}/${id}`); }
}
'@ | Set-Content -Encoding UTF8 "$base\core\services\group.service.ts"

@'
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Permission, PermissionMatrix } from '../models/permission.model';
import { environment } from '../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/permissions`;
  getMatrix(): Observable<PermissionMatrix> { return this.http.get<PermissionMatrix>(`${this.api}/matrix`); }
  getByGroup(gid: number): Observable<Permission[]> { return this.http.get<Permission[]>(`${this.api}/group/${gid}`); }
  updateForGroup(gid: number, p: Permission[]): Observable<Permission[]> { return this.http.put<Permission[]>(`${this.api}/group/${gid}`, { permissions: p }); }
}
'@ | Set-Content -Encoding UTF8 "$base\core\services\permission.service.ts"

@'
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
export interface Notification { id: number; type: 'success'|'error'|'warning'|'info'; message: string; }
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private c = 0;
  private s = new BehaviorSubject<Notification[]>([]);
  public notifications$ = this.s.asObservable();
  success(m: string): void { this.push('success', m); }
  error(m: string): void { this.push('error', m); }
  warning(m: string): void { this.push('warning', m); }
  info(m: string): void { this.push('info', m); }
  private push(t: Notification['type'], m: string): void {
    const id = ++this.c;
    this.s.next([...this.s.value, { id, type: t, message: m }]);
    setTimeout(() => this.s.next(this.s.value.filter(n => n.id !== id)), 4000);
  }
}
'@ | Set-Content -Encoding UTF8 "$base\core\services\notification.service.ts"

# ---- 4. Guards ----
@'
import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);
  canActivate(): boolean {
    if (this.auth.currentUser) return true;
    this.router.navigate(['/login']);
    return false;
  }
}
'@ | Set-Content -Encoding UTF8 "$base\core\guards\auth.guard.ts"

@'
import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Role } from '../models/role.enum';
@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);
  canActivate(route: ActivatedRouteSnapshot): boolean {
    const roles = (route.data['roles'] as Role[]) ?? [];
    if (!roles.length || this.auth.hasAnyRole(roles)) return true;
    this.router.navigate(['/unauthorized']);
    return false;
  }
}
'@ | Set-Content -Encoding UTF8 "$base\core\guards\role.guard.ts"

@'
import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/action.enum';
@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);
  canActivate(route: ActivatedRouteSnapshot): boolean {
    const r = route.data['resource'] as ResourceType | undefined;
    const a = (route.data['action'] as PermissionAction) ?? PermissionAction.Read;
    if (!r || this.auth.hasPermission(r, a)) return true;
    this.router.navigate(['/unauthorized']);
    return false;
  }
}
'@ | Set-Content -Encoding UTF8 "$base\core\guards\permission.guard.ts"

# ---- 5. Interceptors ----
@'
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token;
  if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  return next(req);
};
'@ | Set-Content -Encoding UTF8 "$base\core\interceptors\auth.interceptor.ts"

@'
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { Router } from '@angular/router';
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const notif = inject(NotificationService);
  const router = inject(Router);
  return next(req).pipe(catchError((err: HttpErrorResponse) => {
    if (err.status === 401) auth.logout();
    else if (err.status === 403) { notif.error('Доступ запрещён'); router.navigate(['/unauthorized']); }
    else if (err.status >= 500) notif.error('Ошибка сервера');
    return throwError(() => err);
  }));
};
'@ | Set-Content -Encoding UTF8 "$base\core\interceptors\error.interceptor.ts"

# ---- 6. Компоненты шапки / сайдбара / unauthorized ----
@'
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
@Component({
  selector: 'app-header', standalone: true, imports: [CommonModule],
  template: `<header style="height:60px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;padding:0 24px">
    <div style="font-size:18px;font-weight:500">CarWash Operator</div>
    <div *ngIf="auth.currentUser$ | async as u" style="text-align:right">
      <div style="font-weight:600">{{u.fullName}}</div>
      <div style="font-size:12px;color:#64748b">{{u.group?.displayName}}</div>
    </div>
  </header>`
})
export class HeaderComponent { constructor(public auth: AuthService) {} }
'@ | Set-Content -Encoding UTF8 "$base\shared\components\header\header.component.ts"

@'
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { Role } from '../../../core/models/role.enum';
import { ResourceType } from '../../../core/models/resource.enum';
import { PermissionAction } from '../../../core/models/action.enum';

interface MenuItem { label: string; icon: string; route: string; resource?: ResourceType; allowedRoles?: Role[]; }
const MENU: MenuItem[] = [
  { label: '📊 Дашборд', icon: 'd', route: '/dashboard', resource: ResourceType.Dashboard },
  { label: '📄 Отчёты', icon: 'r', route: '/reports', resource: ResourceType.Reports },
  { label: '💳 Карты клиентов', icon: 'c', route: '/client-cards', resource: ResourceType.ClientCards },
  { label: '👥 Пользователи', icon: 'u', route: '/admin/users', resource: ResourceType.Users, allowedRoles: [Role.Administrator, Role.Developer] },
  { label: '👥 Группы', icon: 'g', route: '/admin/groups', resource: ResourceType.Groups, allowedRoles: [Role.Administrator, Role.Developer] },
  { label: '🔐 Права доступа', icon: 'p', route: '/admin/permissions', resource: ResourceType.Permissions, allowedRoles: [Role.Developer] },
  { label: '🗄️ База данных', icon: 'db', route: '/admin/database', resource: ResourceType.Database, allowedRoles: [Role.Developer] },
  { label: '🧾 ККМ', icon: 'k', route: '/admin/kkm', resource: ResourceType.KKM, allowedRoles: [Role.Developer] },
  { label: '⚙️ Настройки', icon: 's', route: '/admin/settings', resource: ResourceType.SystemSettings, allowedRoles: [Role.Administrator, Role.Developer] }
];

@Component({
  selector: 'app-sidebar', standalone: true, imports: [CommonModule, RouterModule],
  template: `
    <aside style="width:240px;background:#1e293b;color:#cbd5e1;display:flex;flex-direction:column;min-height:100vh">
      <div style="padding:20px;font-size:20px;font-weight:600;color:#fff;border-bottom:1px solid #334155">🚗 CarWash</div>
      <nav style="flex:1;padding:16px 0">
        <a *ngFor="let i of visible()" [routerLink]="i.route" routerLinkActive="active"
           style="display:flex;gap:12px;padding:12px 20px;color:inherit;text-decoration:none">
          {{ i.label }}
        </a>
      </nav>
      <div style="padding:16px;border-top:1px solid #334155">
        <button (click)="auth.logout()" style="width:100%;padding:12px;background:transparent;color:inherit;border:1px solid #475569;border-radius:6px;cursor:pointer">🚪 Выйти</button>
      </div>
    </aside>`
})
export class SidebarComponent {
  constructor(public auth: AuthService) {}
  visible(): MenuItem[] {
    return MENU.filter(i => {
      if (i.allowedRoles && !this.auth.hasAnyRole(i.allowedRoles)) return false;
      if (i.resource && !this.auth.hasPermission(i.resource, PermissionAction.Read)) return false;
      return true;
    });
  }
}
'@ | Set-Content -Encoding UTF8 "$base\shared\components\sidebar\sidebar.component.ts"

@'
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
@Component({
  selector: 'app-unauthorized', standalone: true, imports: [RouterModule],
  template: `<div style="text-align:center;padding:60px 20px">
    <h1 style="color:#ef4444">🚫 Доступ запрещён</h1>
    <p>У вас нет прав для просмотра этой страницы.</p>
    <a routerLink="/dashboard" style="color:#0ea5e9">← На дашборд</a>
  </div>`
})
export class UnauthorizedComponent {}
'@ | Set-Content -Encoding UTF8 "$base\shared\components\unauthorized\unauthorized.component.ts"

# ---- 7. Auth (login / logout) ----
@'
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
@Component({
  selector: 'app-login', standalone: true, imports: [CommonModule, FormsModule],
  template: `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9">
      <form (ngSubmit)="onSubmit()" style="background:#fff;padding:40px;border-radius:12px;width:360px;box-shadow:0 10px 30px rgba(0,0,0,.08)">
        <h1 style="text-align:center">🚗 CarWash</h1>
        <div style="margin-bottom:16px">
          <label>Имя пользователя</label>
          <input [(ngModel)]="username" name="username" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label>Пароль</label>
          <input [(ngModel)]="password" name="password" type="password" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px" />
        </div>
        <p *ngIf="error" style="color:#ef4444">{{error}}</p>
        <button type="submit" [disabled]="loading" style="width:100%;padding:12px;background:#0ea5e9;color:#fff;border:none;border-radius:6px;cursor:pointer">
          {{ loading ? 'Вход...' : 'Войти' }}
        </button>
      </form>
    </div>`
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private notif = inject(NotificationService);
  username = ''; password = ''; loading = false; error = '';
  onSubmit(): void {
    this.loading = true; this.error = '';
    this.auth.login({ username: this.username, password: this.password }).subscribe({
      next: () => { this.notif.success('Добро пожаловать!'); this.router.navigate(['/dashboard']); },
      error: () => { this.error = 'Неверные данные'; this.loading = false; }
    });
  }
}
'@ | Set-Content -Encoding UTF8 "$base\features\auth\login\login.component.ts"

@'
import { Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
@Component({ selector: 'app-logout', standalone: true, template: '' })
export class LogoutComponent implements OnInit {
  private auth = inject(AuthService);
  ngOnInit(): void { this.auth.logout(); }
}
'@ | Set-Content -Encoding UTF8 "$base\features\auth\logout\logout.component.ts"

@'
import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { LogoutComponent } from './logout/logout.component';
export const AUTH_ROUTES: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'logout', component: LogoutComponent }
];
'@ | Set-Content -Encoding UTF8 "$base\features\auth\auth.routes.ts"

# ---- 8. Dashboard ----
@'
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
@Component({
  selector: 'app-dashboard', standalone: true, imports: [CommonModule],
  template: `<div>
    <h1>📊 Дашборд</h1>
    <p *ngIf="auth.currentUser$ | async as u">Добро пожаловать, <b>{{u.fullName}}</b>!</p>
  </div>`
})
export class DashboardComponent { constructor(public auth: AuthService) {} }
'@ | Set-Content -Encoding UTF8 "$base\features\dashboard\dashboard.component.ts"

@'
import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
export const DASHBOARD_ROUTES: Routes = [{ path: '', component: DashboardComponent }];
'@ | Set-Content -Encoding UTF8 "$base\features\dashboard\dashboard.routes.ts"

# ---- 9. Reports ----
@'
import { Component } from '@angular/core';
@Component({ selector: 'app-report-list', standalone: true, template: `<h1>📄 Отчёты</h1>` })
export class ReportListComponent {}
'@ | Set-Content -Encoding UTF8 "$base\features\reports\report-list\report-list.component.ts"

@'
import { Routes } from '@angular/router';
import { ReportListComponent } from './report-list/report-list.component';
export const REPORTS_ROUTES: Routes = [{ path: '', component: ReportListComponent }];
'@ | Set-Content -Encoding UTF8 "$base\features\reports\reports.routes.ts"

# ---- 10. Client Cards ----
@'
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { ResourceType } from '../../../core/models/resource.enum';
import { PermissionAction } from '../../../core/models/action.enum';
@Component({
  selector: 'app-card-list', standalone: true, imports: [CommonModule],
  template: `<div>
    <h1>💳 Карты клиентов</h1>
    <button *ngIf="canDelete()" style="background:#ef4444;color:#fff;padding:10px 16px;border:none;border-radius:6px">Удалить</button>
    <p *ngIf="!canDelete()" style="color:#64748b">Только просмотр</p>
  </div>`
})
export class CardListComponent {
  private auth = inject(AuthService);
  canDelete(): boolean { return this.auth.hasPermission(ResourceType.ClientCards, PermissionAction.Delete); }
}
'@ | Set-Content -Encoding UTF8 "$base\features\client-cards\card-list\card-list.component.ts"

@'
import { Component } from '@angular/core';
@Component({ selector: 'app-card-form', standalone: true, template: `<h1>Карта — редактирование</h1>` })
export class CardFormComponent {}
'@ | Set-Content -Encoding UTF8 "$base\features\client-cards\card-form\card-form.component.ts"

@'
import { Component } from '@angular/core';
@Component({ selector: 'app-card-delete', standalone: true, template: `<h1>Удаление карты</h1>` })
export class CardDeleteComponent {}
'@ | Set-Content -Encoding UTF8 "$base\features\client-cards\card-delete\card-delete.component.ts"

@'
import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { RoleGuard } from '../../core/guards/role.guard';
import { PermissionGuard } from '../../core/guards/permission.guard';
import { ResourceType } from '../../core/models/resource.enum';
import { PermissionAction } from '../../core/models/action.enum';
import { Role } from '../../core/models/role.enum';

export const CLIENT_CARDS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./card-list/card-list.component').then(m => m.CardListComponent),
    canActivate: [AuthGuard, PermissionGuard], data: { resource: ResourceType.ClientCards, action: PermissionAction.Read } },
  { path: 'edit/:id', loadComponent: () => import('./card-form/card-form.component').then(m => m.CardFormComponent),
    canActivate: [AuthGuard, RoleGuard, PermissionGuard],
    data: { roles: [Role.Administrator, Role.Developer], resource: ResourceType.ClientCards, action: PermissionAction.Update } },
  { path: 'delete/:id', loadComponent: () => import('./card-delete/card-delete.component').then(m => m.CardDeleteComponent),
    canActivate: [AuthGuard, RoleGuard, PermissionGuard],
    data: { roles: [Role.Administrator, Role.Developer], resource: ResourceType.ClientCards, action: PermissionAction.Delete } }
];
'@ | Set-Content -Encoding UTF8 "$base\features\client-cards\client-cards.routes.ts"

# ---- 11. Admin: users ----
@'
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UserService } from '../../../../core/services/user.service';
import { GroupService } from '../../../../core/services/group.service';
import { User } from '../../../../core/models/user.model';
import { Group } from '../../../../core/models/group.model';
@Component({
  selector: 'app-user-list', standalone: true, imports: [CommonModule, RouterModule],
  template: `<div>
    <h1>👥 Пользователи</h1>
    <button routerLink="/admin/users/create" style="background:#0ea5e9;color:#fff;padding:10px 16px;border:none;border-radius:6px;margin-bottom:16px">+ Добавить</button>
    <table style="width:100%;background:#fff;border-collapse:collapse">
      <thead><tr style="background:#f8fafc"><th style="padding:12px;text-align:left">ID</th><th style="padding:12px;text-align:left">Логин</th><th style="padding:12px;text-align:left">Email</th><th style="padding:12px;text-align:left">ФИО</th><th style="padding:12px;text-align:left">Группа</th></tr></thead>
      <tbody>
        <tr *ngFor="let u of users"><td style="padding:12px">{{u.id}}</td><td style="padding:12px">{{u.username}}</td><td style="padding:12px">{{u.email}}</td><td style="padding:12px">{{u.fullName}}</td><td style="padding:12px">{{groupName(u.groupId)}}</td></tr>
      </tbody>
    </table>
  </div>`
})
export class UserListComponent implements OnInit {
  private us = inject(UserService);
  private gs = inject(GroupService);
  users: User[] = []; groups: Group[] = [];
  ngOnInit(): void {
    this.gs.getGroups().subscribe(g => this.groups = g);
    this.us.getUsers().subscribe(u => this.users = u);
  }
  groupName(id: number): string { return this.groups.find(g => g.id === id)?.displayName ?? '—'; }
}
'@ | Set-Content -Encoding UTF8 "$base\features\admin\users\user-list\user-list.component.ts"

@'
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { UserService } from '../../../../core/services/user.service';
import { GroupService } from '../../../../core/services/group.service';
import { Group } from '../../../../core/models/group.model';
@Component({
  selector: 'app-user-form', standalone: true, imports: [CommonModule, FormsModule, RouterModule],
  template: `<div>
    <h1>{{isEdit ? 'Редактирование' : 'Новый пользователь'}}</h1>
    <form (ngSubmit)="onSubmit()" style="background:#fff;padding:24px;border-radius:8px;max-width:600px">
      <div style="margin-bottom:16px"><label>Логин</label><input [(ngModel)]="m.username" name="u" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>Email</label><input [(ngModel)]="m.email" name="e" type="email" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>ФИО</label><input [(ngModel)]="m.fullName" name="f" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>Пароль</label><input [(ngModel)]="m.password" name="p" type="password" [required]="!isEdit" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>Группа</label>
        <select [(ngModel)]="m.groupId" name="g" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px">
          <option *ngFor="let g of groups" [ngValue]="g.id">{{g.displayName}}</option>
        </select>
      </div>
      <div style="margin-bottom:16px"><label><input type="checkbox" [(ngModel)]="m.isActive" name="a"/> Активен</label></div>
      <button type="submit" style="background:#0ea5e9;color:#fff;padding:10px 20px;border:none;border-radius:6px;cursor:pointer">Сохранить</button>
      <a routerLink="/admin/users" style="margin-left:12px">Отмена</a>
    </form>
  </div>`
})
export class UserFormComponent implements OnInit {
  private us = inject(UserService);
  private gs = inject(GroupService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  groups: Group[] = []; isEdit = false; userId?: number;
  m = { username: '', email: '', fullName: '', password: '', groupId: 0, isActive: true };
  ngOnInit(): void {
    this.gs.getGroups().subscribe(g => this.groups = g);
    const id = this.route.snapshot.paramMap.get('id');
    if (id) { this.isEdit = true; this.userId = +id; this.us.getUser(this.userId).subscribe(u => this.m = { ...u, password: '' } as any); }
  }
  onSubmit(): void {
    if (this.isEdit && this.userId) {
      const dto: any = { ...this.m }; if (!dto.password) delete dto.password;
      this.us.updateUser(this.userId, dto).subscribe(() => this.router.navigate(['/admin/users']));
    } else {
      this.us.createUser(this.m as any).subscribe(() => this.router.navigate(['/admin/users']));
    }
  }
}
'@ | Set-Content -Encoding UTF8 "$base\features\admin\users\user-form\user-form.component.ts"

@'
import { Routes } from '@angular/router';
export const USERS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./user-list/user-list.component').then(m => m.UserListComponent) },
  { path: 'create', loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent) },
  { path: 'edit/:id', loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent) }
];
'@ | Set-Content -Encoding UTF8 "$base\features\admin\users\users.routes.ts"

# ---- 12. Admin: groups ----
@'
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GroupService } from '../../../../core/services/group.service';
import { Group } from '../../../../core/models/group.model';
@Component({
  selector: 'app-group-list', standalone: true, imports: [CommonModule],
  template: `<div><h1>👥 Группы</h1>
    <table style="width:100%;background:#fff;border-collapse:collapse">
      <thead><tr style="background:#f8fafc"><th style="padding:12px;text-align:left">ID</th><th style="padding:12px;text-align:left">Название</th><th style="padding:12px;text-align:left">Системное имя</th><th style="padding:12px;text-align:left">Описание</th></tr></thead>
      <tbody><tr *ngFor="let g of groups"><td style="padding:12px">{{g.id}}</td><td style="padding:12px">{{g.displayName}}</td><td style="padding:12px"><code>{{g.name}}</code></td><td style="padding:12px">{{g.description}}</td></tr></tbody>
    </table>
  </div>`
})
export class GroupListComponent implements OnInit {
  private gs = inject(GroupService);
  groups: Group[] = [];
  ngOnInit(): void { this.gs.getGroups().subscribe(g => this.groups = g); }
}
'@ | Set-Content -Encoding UTF8 "$base\features\admin\groups\group-list\group-list.component.ts"

@'
import { Routes } from '@angular/router';
export const GROUPS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./group-list/group-list.component').then(m => m.GroupListComponent) }
];
'@ | Set-Content -Encoding UTF8 "$base\features\admin\groups\groups.routes.ts"

# ---- 13. Admin: permissions ----
@'
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GroupService } from '../../../../core/services/group.service';
import { PermissionService } from '../../../../core/services/permission.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { Group } from '../../../../core/models/group.model';
import { Permission } from '../../../../core/models/permission.model';
import { ResourceType } from '../../../../core/models/resource.enum';
import { PermissionAction } from '../../../../core/models/action.enum';

const RL: Record<string,string> = {
  dashboard: '📊 Дашборд', reports: '📄 Отчёты', 'client-cards': '💳 Карты клиентов',
  users: '👥 Пользователи', groups: '👥 Группы', permissions: '🔐 Права доступа',
  database: '🗄️ База данных', kkm: '🧾 ККМ', 'system-settings': '⚙️ Настройки'
};
const AL: Record<string,string> = { read: 'Чтение', write: 'Запись', update: 'Изменение', delete: 'Удаление' };

@Component({
  selector: 'app-permission-editor', standalone: true, imports: [CommonModule, FormsModule],
  template: `<div>
    <h1>🔐 Права доступа</h1>
    <div style="margin-bottom:20px">
      <label>Группа: </label>
      <select [(ngModel)]="selectedGroupId" (ngModelChange)="onChange($event)" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;min-width:240px">
        <option [ngValue]="null">— выберите —</option>
        <option *ngFor="let g of groups" [ngValue]="g.id">{{g.displayName}}</option>
      </select>
    </div>
    <div *ngIf="selectedGroupId && !isDev">
      <table style="width:100%;background:#fff;border-collapse:collapse">
        <thead><tr style="background:#f8fafc"><th style="padding:12px;text-align:left">Ресурс</th><th *ngFor="let a of actions" style="padding:12px">{{al[a]}}</th></tr></thead>
        <tbody><tr *ngFor="let r of resources"><td style="padding:12px">{{rl[r]}}</td>
          <td *ngFor="let a of actions" style="padding:12px;text-align:center"><input type="checkbox" [checked]="isChecked(r,a)" (change)="toggle(r,a,$event)"/></td>
        </tr></tbody>
      </table>
      <button (click)="save()" style="margin-top:20px;background:#0ea5e9;color:#fff;padding:12px 24px;border:none;border-radius:6px;cursor:pointer">💾 Сохранить</button>
    </div>
    <div *ngIf="isDev" style="background:#dbeafe;color:#1e40af;padding:16px;border-radius:8px;margin-top:20px">
      ℹ️ Группа «Разработчик» имеет полный доступ. Права не редактируются.
    </div>
  </div>`
})
export class PermissionEditorComponent implements OnInit {
  private gs = inject(GroupService);
  private ps = inject(PermissionService);
  private notif = inject(NotificationService);
  groups: Group[] = []; selectedGroupId: number | null = null; isDev = false;
  resources = Object.values(ResourceType);
  actions = Object.values(PermissionAction);
  rl = RL; al = AL;
  permissions: Permission[] = [];

  ngOnInit(): void { this.gs.getGroups().subscribe(g => this.groups = g); }
  onChange(id: number | null): void {
    if (!id) { this.permissions = []; return; }
    const g = this.groups.find(x => x.id === id);
    this.isDev = g?.name === 'developer';
    if (!this.isDev) this.ps.getByGroup(id).subscribe(p => this.permissions = p);
  }
  isChecked(r: ResourceType, a: PermissionAction): boolean {
    const p = this.permissions.find(x => x.resource === r);
    return p ? p.actions.includes(a) : false;
  }
  toggle(r: ResourceType, a: PermissionAction, e: Event): void {
    const c = (e.target as HTMLInputElement).checked;
    let p = this.permissions.find(x => x.resource === r);
    if (!p) { p = { id: 0, groupId: this.selectedGroupId!, resource: r, actions: [] }; this.permissions.push(p); }
    if (c) { if (!p.actions.includes(a)) p.actions.push(a); }
    else p.actions = p.actions.filter(x => x !== a);
  }
  save(): void {
    if (!this.selectedGroupId) return;
    this.ps.updateForGroup(this.selectedGroupId, this.permissions).subscribe({
      next: () => this.notif.success('Права сохранены'),
      error: () => this.notif.error('Ошибка')
    });
  }
}
'@ | Set-Content -Encoding UTF8 "$base\features\admin\permissions\permission-editor\permission-editor.component.ts"

@'
import { Routes } from '@angular/router';
export const PERMISSIONS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./permission-editor/permission-editor.component').then(m => m.PermissionEditorComponent) }
];
'@ | Set-Content -Encoding UTF8 "$base\features\admin\permissions\permissions.routes.ts"

# ---- 14. Admin: database ----
@'
import { Component } from '@angular/core';
@Component({ selector: 'app-database-backup', standalone: true, template: `<h1>🗄️ База данных</h1><p>Резервное копирование / восстановление / миграции</p>` })
export class DatabaseBackupComponent {}
'@ | Set-Content -Encoding UTF8 "$base\features\admin\database\database-backup\database-backup.component.ts"

@'
import { Routes } from '@angular/router';
export const DATABASE_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./database-backup/database-backup.component').then(m => m.DatabaseBackupComponent) }
];
'@ | Set-Content -Encoding UTF8 "$base\features\admin\database\database.routes.ts"

# ---- 15. Admin: kkm ----
@'
import { Component } from '@angular/core';
@Component({ selector: 'app-kkm-list', standalone: true, template: `<h1>🧾 ККМ</h1><p>Управление кассовыми аппаратами</p>` })
export class KkmListComponent {}
'@ | Set-Content -Encoding UTF8 "$base\features\admin\kkm\kkm-list\kkm-list.component.ts"

@'
import { Routes } from '@angular/router';
export const KKM_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./kkm-list/kkm-list.component').then(m => m.KkmListComponent) }
];
'@ | Set-Content -Encoding UTF8 "$base\features\admin\kkm\kkm.routes.ts"

# ---- 16. Admin: settings ----
@'
import { Component } from '@angular/core';
@Component({ selector: 'app-general-settings', standalone: true, template: `<h1>⚙️ Настройки системы</h1>` })
export class GeneralSettingsComponent {}
'@ | Set-Content -Encoding UTF8 "$base\features\admin\settings\general-settings\general-settings.component.ts"

@'
import { Routes } from '@angular/router';
export const SETTINGS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./general-settings/general-settings.component').then(m => m.GeneralSettingsComponent) }
];
'@ | Set-Content -Encoding UTF8 "$base\features\admin\settings\settings.routes.ts"

# ---- 17. Admin root routes ----
@'
import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { RoleGuard } from '../../core/guards/role.guard';
import { Role } from '../../core/models/role.enum';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: [Role.Administrator, Role.Developer] },
    children: [
      { path: 'users', loadChildren: () => import('./users/users.routes').then(m => m.USERS_ROUTES) },
      { path: 'groups', loadChildren: () => import('./groups/groups.routes').then(m => m.GROUPS_ROUTES) },
      { path: 'permissions', canActivate: [RoleGuard], data: { roles: [Role.Developer] },
        loadChildren: () => import('./permissions/permissions.routes').then(m => m.PERMISSIONS_ROUTES) },
      { path: 'database', canActivate: [RoleGuard], data: { roles: [Role.Developer] },
        loadChildren: () => import('./database/database.routes').then(m => m.DATABASE_ROUTES) },
      { path: 'kkm', canActivate: [RoleGuard], data: { roles: [Role.Developer] },
        loadChildren: () => import('./kkm/kkm.routes').then(m => m.KKM_ROUTES) },
      { path: 'settings', loadChildren: () => import('./settings/settings.routes').then(m => m.SETTINGS_ROUTES) }
    ]
  }
];
'@ | Set-Content -Encoding UTF8 "$base\features\admin\admin.routes.ts"

Write-Host "✅ Все файлы созданы!" -ForegroundColor Green
Write-Host ""
Write-Host "Следующий шаг:" -ForegroundColor Yellow
Write-Host "  cd frontend"
Write-Host "  npm start"