import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import type { HistoryPage } from '../../feature-flag.facade.js';

export class FlagHistoryQuery implements HistoryPage {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
