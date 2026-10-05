export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  phone?: string;
  groupId: number;
  group?: Group;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

export interface CreateUserDto {
  username: string;
  email: string;
  password: string;
  fullName: string;
  groupId: number;
  isActive: boolean;
}

export interface UpdateUserDto extends Partial<Omit<CreateUserDto, 'password'>> {
  password?: string;
}
