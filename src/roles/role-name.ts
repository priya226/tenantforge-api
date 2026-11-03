export const ROLE_NAMES = [
  'PLATFORM_ADMIN',
  'COMPANY_ADMIN',
  'VIEWER',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];
