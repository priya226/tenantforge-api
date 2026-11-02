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

import { ROLE_NAMES, type RoleName } from '../../roles/role-name.js';
import type { CreateUserInput } from '../users.service.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Body of POST /users.
export class CreateUserDto implements CreateUserInput {
  @IsUUID()
  companyId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200) // matches varchar(200) in V2
  name!: string;

  // Trimmed here so the format check sees the real value; the service lowercases it.
  @Transform(trim)
  @IsEmail()
  @MaxLength(254) // matches varchar(254) in V2
  email!: string;

  // Length is what makes a password strong (NIST guidance), so there are no "must contain a symbol" rules.
  // The maximum stops a huge "password" from making argon2 burn CPU. Not trimmed: spaces are allowed.
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  // Optional; the service defaults to ["VIEWER"]. Whether the roles fit the company is checked in RolesService.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ROLE_NAMES, { each: true })
  roles?: RoleName[];
}
