import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  FLAG_KEY_PATTERN,
  MAX_ROLLOUT_COUNT,
  MAX_RULES,
  ROLLOUT_TYPES,
  type RolloutType,
} from '../../../flags/flag-key.js';
import type { CreateFlagInput } from '../../../flags/flags.service.js';
import { FlagRuleDto } from './flag-rule.dto.js';

export class CreateFlagDto implements CreateFlagInput {
  @IsString()
  @Matches(FLAG_KEY_PATTERN, {
    message:
      'key must be 2-64 characters: lowercase letters, digits and dashes, starting with a letter',
  })
  key!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(ROLLOUT_TYPES)
  rolloutType?: RolloutType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ROLLOUT_COUNT)
  rolloutValue?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RULES)
  @ValidateNested({ each: true })
  @Type(() => FlagRuleDto)
  rules?: FlagRuleDto[];
}
