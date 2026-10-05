export const API_ENDPOINTS = {
  AUTH: { LOGIN: '/auth/login', LOGOUT: '/auth/logout', REFRESH: '/auth/refresh' },
  USERS: '/users',
  GROUPS: '/groups',
  PERMISSIONS: '/permissions',
  CLIENT_CARDS: '/client-cards',
  DASHBOARD: '/dashboard',
  REPORTS: '/reports',
  DATABASE: '/database',
  KKM: '/kkm',
  SETTINGS: '/settings'
} as const;