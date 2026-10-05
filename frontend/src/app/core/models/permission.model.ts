import { ResourceType } from './resource.enum';

export { ResourceType };   // ← реэкспорт

export enum PermissionAction {
  View = 'view',
  Create = 'create',
  Update = 'update',
  Delete = 'delete'
}

export interface Permission {
  id: number;
  groupId: number;
  resource: ResourceType;
  action: PermissionAction;
}

export interface PermissionMatrix {
  [groupId: number]: {
    [resource in ResourceType]?: PermissionAction[];
  };
}
