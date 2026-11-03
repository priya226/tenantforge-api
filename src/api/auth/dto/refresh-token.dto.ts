import { IsString, Matches } from 'class-validator';

export class RefreshTokenDto {
  // 32 random bytes in base64url
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'refreshToken is not valid' })
  refreshToken!: string;
}
