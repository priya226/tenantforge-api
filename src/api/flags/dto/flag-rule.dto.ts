import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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

  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;
}
