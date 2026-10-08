import { Component, OnInit, inject } from '@angular/core';

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
  selector: 'app-permission-editor', standalone: true, imports: [FormsModule],
  template: `<div>
      <h1>🔐 Права доступа</h1>
      <div style="margin-bottom:20px">
        <label>Группа: </label>
        <select [(ngModel)]="selectedGroupId" (ngModelChange)="onChange($event)" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;min-width:240px">
          <option [ngValue]="null">— выберите —</option>
          @for (g of groups; track g) {
            <option [ngValue]="g.id">{{g.displayName}}</option>
          }
        </select>
      </div>
      @if (selectedGroupId && !isDev) {
        <div>
          <table style="width:100%;background:#fff;border-collapse:collapse">
            <thead><tr style="background:#f8fafc"><th style="padding:12px;text-align:left">Ресурс</th>@for (a of actions; track a) {
            <th style="padding:12px">{{al[a]}}</th>
          }</tr></thead>
          <tbody>@for (r of resources; track r) {
            <tr><td style="padding:12px">{{rl[r]}}</td>
            @for (a of actions; track a) {
              <td style="padding:12px;text-align:center"><input type="checkbox" [checked]="isChecked(r,a)" (change)="toggle(r,a,$event)"/></td>
            }
          </tr>
        }</tbody>
      </table>
      <button (click)="save()" style="margin-top:20px;background:#0ea5e9;color:#fff;padding:12px 24px;border:none;border-radius:6px;cursor:pointer">💾 Сохранить</button>
    </div>
    }
    @if (isDev) {
      <div style="background:#dbeafe;color:#1e40af;padding:16px;border-radius:8px;margin-top:20px">
        ℹ️ Группа «Разработчик» имеет полный доступ. Права не редактируются.
      </div>
    }
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
