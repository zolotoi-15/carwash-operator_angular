import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ResourceType } from '../../../core/models/resource.enum';
import { PermissionAction, Permission } from '../../../core/models/permission.model';

@Component({
  selector: 'app-permission-matrix',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <table>
      <thead>
        <tr>
          <th>Ресурс</th>
          <th *ngFor="let action of actions">{{ actionLabels[action] }}</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let resource of resources">
          <td>{{ resourceLabels[resource] }}</td>
          <td *ngFor="let action of actions">
            <input type="checkbox"
              [checked]="isChecked(resource, action)"
              (change)="toggle(resource, action, $event)" />
          </td>
        </tr>
      </tbody>
    </table>
  `
})
export class PermissionMatrixComponent {
  @Input() resources: ResourceType[] = Object.values(ResourceType);
  @Input() actions: PermissionAction[] = Object.values(PermissionAction);
  @Input() permissions: Permission[] = [];
  @Output() permissionsChange = new EventEmitter<Permission[]>();

  resourceLabels: Record<ResourceType, string> = {
    [ResourceType.Dashboard]:      'Дашборд',
    [ResourceType.Reports]:        'Отчёты',
    [ResourceType.ClientCards]:    'Карты клиентов',
    [ResourceType.Users]:          'Пользователи',
    [ResourceType.Groups]:         'Группы',
    [ResourceType.Permissions]:    'Права доступа',
    [ResourceType.Database]:       'База данных',
    [ResourceType.KKM]:            'ККМ',
    [ResourceType.SystemSettings]: 'Системные настройки',
  };

  actionLabels: Record<PermissionAction, string> = {
    [PermissionAction.Read]:   'Чтение',
    [PermissionAction.Write]:  'Запись',
    [PermissionAction.Update]: 'Изменение',
    [PermissionAction.Delete]: 'Удаление',
  };

  isChecked(resource: ResourceType, action: PermissionAction): boolean {
    const p = this.permissions.find(x => x.resource === resource);
    return p ? p.actions.includes(action) : false;
  }

  toggle(resource: ResourceType, action: PermissionAction, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    let p = this.permissions.find(x => x.resource === resource);
    if (!p) {
      // groupId временно 0 — родитель подставит нужный
      p = { id: 0, groupId: 0, resource, actions: [] };
      this.permissions = [...this.permissions, p];
    } else {
      this.permissions = this.permissions.map(x => x === p ? { ...p } : x);
      p = this.permissions.find(x => x.resource === resource)!;
    }
    if (checked) {
      if (!p.actions.includes(action)) p.actions = [...p.actions, action];
    } else {
      p.actions = p.actions.filter(a => a !== action);
    }
    this.permissionsChange.emit(this.permissions);
  }
}