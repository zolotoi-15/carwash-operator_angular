export enum PermissionAction {
  Read = 'read',
  Write = 'write',
  Update = 'update',
  Delete = 'delete'
}

export enum ResourceType {
  Dashboard = 'dashboard',
  Reports = 'reports',
  ClientCards = 'client-cards',
  Database = 'database',
  KKM = 'kkm',
  SystemSettings = 'system-settings',
  UserManagement = 'user-management'
}

export interface Permission {
  id: number;
  groupId: number;
  resource: ResourceType;
  actions: PermissionAction[];
}