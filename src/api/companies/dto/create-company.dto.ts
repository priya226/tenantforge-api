import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import type { CreateCompanyInput } from '../../../companies/companies.service.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCompanyDto implements CreateCompanyInput {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200) // matches varchar(200) in V1__create_company.sql
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}
