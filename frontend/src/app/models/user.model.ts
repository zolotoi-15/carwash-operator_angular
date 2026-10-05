export interface User {
  id: number;
  name: string;
  email: string;
  group: UserGroup;
}

export type UserGroup = 'разработчик' | 'администратор' | 'оператор';

export const DEFAULT_USER_GROUPS: UserGroup[] = [
  'разработчик',
  'администратор',
  'оператор'
];
