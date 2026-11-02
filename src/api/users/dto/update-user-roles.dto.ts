import { ArrayNotEmpty, IsArray, IsIn } from 'class-validator';

import { ROLE_NAMES, type RoleName } from '../../../roles/role-name.js';

// Body of PUT /users/:id/roles. The list REPLACES the user's roles; it is not added to them.
export class UpdateUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ROLE_NAMES, { each: true })
  roles!: RoleName[];
}
