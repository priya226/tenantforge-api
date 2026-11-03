import { IsInt, Min } from 'class-validator';

export class RollbackFlagDto {
  @IsInt()
  @Min(1)
  toVersion!: number;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
