export enum GroupType {
  Administrator = 'administrator',
  Developer = 'developer',
  Operator = 'operator'
}

export interface Group {
  id: number;
  name: GroupType;
  displayName: string;
  description: string;
}