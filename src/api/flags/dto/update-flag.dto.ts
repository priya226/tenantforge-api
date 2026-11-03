import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  MAX_ROLLOUT_COUNT,
  MAX_RULES,
  ROLLOUT_TYPES,
  type RolloutType,
} from '../../../flags/flag-key.js';
import type { FlagState } from '../../../flags/flags.service.js';
import { FlagRuleDto } from './flag-rule.dto.js';

export class UpdateFlagDto implements FlagState {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description: string | null = null;

  @IsBoolean()
  enabled!: boolean;

  @IsIn(ROLLOUT_TYPES)
  rolloutType!: RolloutType;

  @IsInt()
  @Min(0)
  @Max(MAX_ROLLOUT_COUNT)
  rolloutValue!: number;

  @IsArray()
  @ArrayMaxSize(MAX_RULES)
  @ValidateNested({ each: true })
  @Type(() => FlagRuleDto)
  rules!: FlagRuleDto[];
}
