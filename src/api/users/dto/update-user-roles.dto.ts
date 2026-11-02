import { ArrayNotEmpty, IsArray, IsIn } from 'class-validator';

import { ROLE_NAMES, type RoleName } from '../../../roles/role-name.js';

export class UpdateUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ROLE_NAMES, { each: true })
  roles!: RoleName[];
}
