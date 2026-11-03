import { Group } from './group.model';

export interface User {
  id: number;
  username: string;
  name: string;
  fullName: string;
  email: string;
  groupId: number;
  group?: Group;
}

export interface CreateUserDto {
  username: string;
  fullName: string;
  email: string;
  password: string;
  groupId: number;
}

export interface UpdateUserDto {
  username?: string;
  fullName?: string;
  email?: string;
  groupId?: number;
}