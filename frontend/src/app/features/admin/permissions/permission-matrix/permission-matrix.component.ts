// src/app/features/admin/permissions/permission-matrix/permission-matrix.component.ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ResourceType } from '../../../../core/models/resource.enum';
import { PermissionAction, Permission } from '../../../../core/models/permission.model';

@Component({
  selector: 'app-permission-matrix',
  standalone: true,
  imports: [CommonModule],
  template: `
    <table class="permission-matrix">
      <thead>
        <tr>
          <th>Ресурс</th>
          <th *ngFor="let action of actions">{{ actionLabels[action] }}</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let resource of resources">
          <td>{{ resourceLabels[resource] }}</td>
          <td *ngFor="let action of actions" class="cell-check">
            <input
              type="checkbox"
              [checked]="isChecked(resource, action)"
              (change)="toggle(resource, action, $event)" />
          </td>
        </tr>
      </tbody>
    </table>
  `,
  styles: [`
    .permission-matrix {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
    }
    .permission-matrix th,
    .permission-matrix td {
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
      text-align: left;
      font-size: 13px;
    }
    .permission-matrix th {
      background: #f8fafc;
      font-weight: 600;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
    }
    .permission-matrix .cell-check {
      text-align: center;
    }
  `],
})
export class PermissionMatrixComponent {
  @Input() resources: ResourceType[] = Object.values(ResourceType);
  @Input() actions: PermissionAction[] = Object.values(PermissionAction);
  @Input() permissions: Permission[] = [];
  @Output() permissionsChange = new EventEmitter<Permission[]>();

  readonly resourceLabels: Record<ResourceType, string> = {
    [ResourceType.Dashboard]:      '📊 Дашборд',
    [ResourceType.Reports]:        '📄 Отчёты',
    [ResourceType.ClientCards]:    '💳 Карты клиентов',
    [ResourceType.Users]:          '👥 Пользователи',
    [ResourceType.Groups]:         '👥 Группы',
    [ResourceType.Permissions]:    '🔐 Права доступа',
    [ResourceType.Database]:       '🗄️ База данных',
    [ResourceType.KKM]:            '🧾 ККМ',
    [ResourceType.SystemSettings]: '⚙️ Системные настройки',
  };

  readonly actionLabels: Record<PermissionAction, string> = {
    [PermissionAction.Read]:   'Чтение',
    [PermissionAction.Write]:  'Запись',
    [PermissionAction.Update]: 'Изменение',
    [PermissionAction.Delete]: 'Удаление',
  };

  isChecked(resource: ResourceType, action: PermissionAction): boolean {
    const p = this.permissions.find(x => x.resource === resource);
    return !!p && p.actions.includes(action);
  }

  toggle(resource: ResourceType, action: PermissionAction, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const idx = this.permissions.findIndex(x => x.resource === resource);

    let next: Permission[];

    if (idx >= 0) {
      const current = this.permissions[idx];
      const actions = checked
        ? Array.from(new Set([...current.actions, action]))
        : current.actions.filter(a => a !== action);
      next = this.permissions.map((p, i) =>
        i === idx ? { ...p, actions } : p,
      );
    } else if (checked) {
      next = [
        ...this.permissions,
        { id: 0, groupId: 0, resource, actions: [action] },
      ];
    } else {
      next = this.permissions;
    }

    this.permissions = next;
    this.permissionsChange.emit(next);
  }
}