@Component({
  selector: 'app-permission-matrix',
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
    [ResourceType.Dashboard]: 'Дашборд',
    [ResourceType.Reports]: 'Отчёты',
    [ResourceType.ClientCards]: 'Карты клиентов',
    [ResourceType.Users]: 'Пользователи',
    [ResourceType.Groups]: 'Группы',
    [ResourceType.Permissions]: 'Права доступа',
    [ResourceType.Database]: 'База данных',
    [ResourceType.KKM]: 'ККМ',
    [ResourceType.SystemSettings]: 'Системные настройки'
  };

  actionLabels: Record<PermissionAction, string> = {
    [PermissionAction.Read]: 'Чтение',
    [PermissionAction.Write]: 'Запись',
    [PermissionAction.Update]: 'Изменение',
    [PermissionAction.Delete]: 'Удаление'
  };
}