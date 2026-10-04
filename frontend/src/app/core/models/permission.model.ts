import { ResourceType } from './resource.enum';
import { PermissionAction } from './action.enum';
export interface Permission { id: number; groupId: number; resource: ResourceType; actions: PermissionAction[]; }
export interface PermissionMatrix { [groupId: number]: { [resource: string]: PermissionAction[] }; }
