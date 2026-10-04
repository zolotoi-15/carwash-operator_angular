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
