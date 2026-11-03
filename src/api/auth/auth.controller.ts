import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { AuthTokens } from '../../auth/auth.service.js';
import { FeatureFlagFacade } from '../feature-flag.facade.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly facade: FeatureFlagFacade) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.facade.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokens> {
    return this.facade.refreshSession(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.facade.logout(dto.refreshToken);
  }
}
