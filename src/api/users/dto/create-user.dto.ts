import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { ROLE_NAMES, type RoleName } from '../../../roles/role-name.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../users/password-policy.js';
import type { CreateUserRequest } from '../../feature-flag.facade.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto implements CreateUserRequest {
  @IsUUID()
  companyId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200) // matches varchar(200) in V2
  name!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(254) // matches varchar(254) in V2
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ROLE_NAMES, { each: true })
  roles?: RoleName[];
}
