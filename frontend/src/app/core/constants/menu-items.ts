import { MenuItem } from '../models/menu-item.model';
import { ResourceType } from '../models/resource.enum';
import { Role } from '../models/role.enum';

export const MENU_ITEMS: MenuItem[] = [
  { label: '📊 Дашборд', icon: 'dashboard', route: '/dashboard', resource: ResourceType.Dashboard },
  { label: '📄 Отчёты', icon: 'reports', route: '/reports', resource: ResourceType.Reports },
  { label: '💳 Карты клиентов', icon: 'cards', route: '/client-cards', resource: ResourceType.ClientCards },

  { label: '👥 Пользователи', icon: 'users', route: '/admin/users',
    resource: ResourceType.Users, allowedRoles: [Role.ADMINISTRATOR, Role.DEVELOPER] },
  { label: '👥 Группы', icon: 'groups', route: '/admin/groups',
    resource: ResourceType.Groups, allowedRoles: [Role.ADMINISTRATOR, Role.DEVELOPER] },
  { label: '🔐 Права доступа', icon: 'permissions', route: '/admin/permissions',
    resource: ResourceType.Permissions, allowedRoles: [Role.DEVELOPER] },
  { label: '🗄️ База данных', icon: 'database', route: '/admin/database',
    resource: ResourceType.Database, allowedRoles: [Role.DEVELOPER] },
  { label: '🧾 ККМ', icon: 'kkm', route: '/admin/kkm',
    resource: ResourceType.KKM, allowedRoles: [Role.DEVELOPER] },
  { label: '⚙️ Настройки', icon: 'settings', route: '/admin/settings',
    resource: ResourceType.SystemSettings, allowedRoles: [Role.ADMINISTRATOR, Role.DEVELOPER] },

  { label: '🚪 Выйти', icon: 'logout', route: '/logout' }
];