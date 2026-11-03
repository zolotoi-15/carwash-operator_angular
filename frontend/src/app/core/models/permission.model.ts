import { ResourceType } from './resource.enum';

// Реэкспорт, чтобы сервисы могли импортировать оба из одного места
export { ResourceType };

export enum PermissionAction {
  Read = 'read',
  Write = 'write',
  Update = 'update',
  Delete = 'delete'
}

export interface Permission {
  id?: number;
  groupId: number;
  resource: ResourceType;
  actions: PermissionAction[];   // 👈 именно массив
}

export interface PermissionMatrix {
  [resource: string]: PermissionAction[];
}