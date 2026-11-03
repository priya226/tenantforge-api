import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseModule } from '../database/database.module.js';
import { AuthService } from './auth.service.js';
import { RefreshToken } from './refresh-token.entity.js';
import { RefreshTokenRepository } from './refresh-token.repository.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [AuthService, RefreshTokenRepository],
  exports: [AuthService],
})
export class AuthModule {}
