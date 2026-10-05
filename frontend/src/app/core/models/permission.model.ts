import { ResourceType } from './resource.enum';
import { PermissionAction } from './action.enum';

export interface Permission {
  id: number;
  groupId: number;
  resource: ResourceType;
  actions: PermissionAction[];
}

export interface PermissionMatrix {
  [groupId: number]: {
    [resource in ResourceType]?: PermissionAction[];
  };
}

export interface UpdatePermissionsDto {
  groupId: number;
  permissions: Array<{
    resource: ResourceType;
    actions: PermissionAction[];
  }>;
}
