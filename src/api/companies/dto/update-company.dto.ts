import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import type { UpdateCompanyInput } from '../../../companies/companies.service.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Body of PATCH /companies/:id. Every field is optional; only the fields sent are changed.
export class UpdateCompanyDto implements UpdateCompanyInput {
  // Skip validation only when name is left out. Sending null is rejected, because the column is NOT NULL.
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  // null is allowed and clears the description.
  @IsOptional()
  @IsString()
  description?: string | null;
}
