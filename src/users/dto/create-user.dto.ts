import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

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
}
