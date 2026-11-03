import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  MAX_ROLLOUT_COUNT,
  ROLLOUT_TYPES,
  type RolloutType,
} from '../../../flags/flag-key.js';
import type { FlagRule } from '../../../flags/flag-rule.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class FlagRuleDto implements FlagRule {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  attribute!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  value!: string;

  @IsIn(ROLLOUT_TYPES)
  rolloutType!: RolloutType;

  @IsInt()
  @Min(0)
  @Max(MAX_ROLLOUT_COUNT)
  rolloutValue!: number;
}
