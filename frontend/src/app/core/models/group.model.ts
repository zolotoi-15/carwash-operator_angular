import { Role } from './role.enum';
export interface Group { id: number; name: Role; displayName: string; description: string; isSystem: boolean; userCount?: number; }
export interface CreateGroupDto { name: Role; displayName: string; description: string; }

export enum GroupType {
  Administrator = 'administrator',
  Developer = 'developer',
  Operator = 'operator'
}

export interface Group {
  id: number;
  name: GroupType;
  displayName: string;      // "Администратор", "Разработчик", "Оператор"
  description: string;
  isSystem: boolean;        // системные группы нельзя удалять
  userCount?: number;
  createdAt: Date;
}

export interface CreateGroupDto {
  name: string;
  displayName: string;
  description: string;
}
