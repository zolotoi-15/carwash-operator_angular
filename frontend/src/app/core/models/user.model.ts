import { Group } from './group.model';
import { Permission } from './permission.model';
export interface User { id: number; username: string; email: string; fullName: string; groupId: number; group?: Group; isActive: boolean; }
export interface CreateUserDto { username: string; email: string; password: string; fullName: string; groupId: number; isActive: boolean; }
export interface UpdateUserDto extends Partial<Omit<CreateUserDto,'password'>> { password?: string; }
export interface LoginDto { username: string; password: string; }
export interface LoginResponse { token: string; user: User; permissions: Permission[]; }
