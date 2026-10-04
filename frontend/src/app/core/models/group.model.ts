import { Role } from './role.enum';
export interface Group { id: number; name: Role; displayName: string; description: string; isSystem: boolean; userCount?: number; }
export interface CreateGroupDto { name: Role; displayName: string; description: string; }
