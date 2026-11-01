import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Body of POST /companies.
export class CreateCompanyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200) // matches varchar(200) in V1__create_company.sql
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}
