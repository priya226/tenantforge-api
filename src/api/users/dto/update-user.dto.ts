import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200) // matches varchar(200) in V2
  name!: string;
}
