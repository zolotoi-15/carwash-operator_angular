export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  groupId: number;
  isActive: boolean;
  createdAt: Date;
}