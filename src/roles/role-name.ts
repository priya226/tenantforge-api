// The fixed set of roles. They must match the rows inserted by V3__create_role_and_user_role.sql.
// Code checks roles by these names, never by id (ids are random UUIDs that differ per database).
export const ROLE_NAMES = [
  'PLATFORM_ADMIN',
  'COMPANY_ADMIN',
  'VIEWER',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];
