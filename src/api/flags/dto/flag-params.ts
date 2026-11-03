import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';

import { FLAG_KEY_PATTERN } from '../../../flags/flag-key.js';

export class FlagKeyParams {
  @Matches(FLAG_KEY_PATTERN, { message: 'Invalid flag key' })
  key!: string;
}

export class CompanyQuery {
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class ExpectedVersionQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
