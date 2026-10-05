// core/models/role.model.ts
export const ROLES = {
  ADMINISTRATOR: 'administrator',
  DEVELOPER: 'developer',
  OPERATOR: 'operator'
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];