import { Role } from './role.enum';

export interface Group {
  id: number;
  name: Role;
  displayName: string;
}

export interface CreateGroupDto {
  name: Role;
  displayName: string;
}