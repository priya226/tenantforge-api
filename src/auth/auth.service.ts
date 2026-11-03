import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { ALL_COMPANIES, type TenantScope } from '../common/tenant-scope.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import type { RoleName } from '../roles/role-name.js';
import { RefreshToken } from './refresh-token.entity.js';
import { RefreshTokenRepository } from './refresh-token.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenSubject {
  userId: string;
  companyId: string | null;
  roles: RoleName[];
}

export interface AccessTokenPayload {
  sub: string;
  companyId: string | null;
  roles: RoleName[];
}

export type VerifiedAccessToken = AccessTokenPayload & {
  iat: number;
  exp: number;
};

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

class TokenAlreadyRotatedError extends Error {}

@Injectable()
export class AuthService {
  private readonly accessTtlSeconds: number;
  private readonly idleMs: number;
  private readonly absoluteMs: number;

  constructor(
    private readonly tokens: RefreshTokenRepository,
    private readonly jwt: JwtService,
    private readonly transactions: TransactionRunner,
    config: ConfigService,
  ) {
    this.accessTtlSeconds = Number(
      config.getOrThrow<string>('JWT_ACCESS_TTL_SECONDS'),
    );
    this.idleMs =
      Number(config.getOrThrow<string>('REFRESH_IDLE_DAYS')) * DAY_MS;
    this.absoluteMs =
      Number(config.getOrThrow<string>('REFRESH_ABSOLUTE_DAYS')) * DAY_MS;
  }

  tenantScope(actor: TokenSubject): TenantScope {
    if (actor.companyId) {
      return { kind: 'company', companyId: actor.companyId };
    }
    if (actor.roles.includes('PLATFORM_ADMIN')) {
      return ALL_COMPANIES;
    }
    throw new ForbiddenException('You do not have permission to do this');
  }

  rejectLogin(): never {
    throw new UnauthorizedException('Invalid email or password');
  }

  async startSession(subject: TokenSubject): Promise<AuthTokens> {
    const now = new Date();
    const familyExpiresAt = new Date(now.getTime() + this.absoluteMs);
    const { raw } = await this.saveNewToken(
      subject.userId,
      randomUUID(),
      familyExpiresAt,
      now,
    );
    return this.buildTokens(subject, raw);
  }

  async findSession(rawToken: string): Promise<RefreshToken> {
    const token = await this.tokens.findByHash(hashToken(rawToken));
    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (token.revokedAt) {
      return this.endSession(token);
    }
    if (token.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired');
    }
    return token;
  }

  async endSession(token: RefreshToken): Promise<never> {
    await this.tokens.revokeFamily(token.familyId, new Date());
    throw new UnauthorizedException('Session ended, please log in again');
  }

  async rotate(old: RefreshToken, subject: TokenSubject): Promise<AuthTokens> {
    try {
      const raw = await this.transactions.run(async (tx) => {
        const now = new Date();
        const next = await this.saveNewToken(
          old.userId,
          old.familyId,
          old.familyExpiresAt,
          now,
          this.tokens.withTransaction(tx),
        );
        const won = await this.tokens
          .withTransaction(tx)
          .markReplaced(old.id, next.token.id, now);
        if (!won) {
          throw new TokenAlreadyRotatedError();
        }
        return next.raw;
      });
      return await this.buildTokens(subject, raw);
    } catch (error) {
      if (error instanceof TokenAlreadyRotatedError) {
        return this.endSession(old);
      }
      throw error;
    }
  }

  async logout(rawToken: string): Promise<void> {
    const token = await this.tokens.findByHash(hashToken(rawToken));
    if (token) {
      await this.tokens.revokeFamily(token.familyId, new Date());
    }
  }

  verifyAccessToken(accessToken: string): Promise<VerifiedAccessToken> {
    return this.jwt.verifyAsync<VerifiedAccessToken>(accessToken);
  }

  private async saveNewToken(
    userId: string,
    familyId: string,
    familyExpiresAt: Date,
    now: Date,
    tokens: RefreshTokenRepository = this.tokens,
  ): Promise<{ raw: string; token: RefreshToken }> {
    const raw = randomBytes(32).toString('base64url');
    const idleExpiry = now.getTime() + this.idleMs;
    const token = tokens.create({
      userId,
      familyId,
      tokenHash: hashToken(raw),
      familyExpiresAt,
      expiresAt: new Date(Math.min(idleExpiry, familyExpiresAt.getTime())),
      revokedAt: null,
      replacedById: null,
    });
    return { raw, token: await tokens.save(token) };
  }

  private async buildTokens(
    subject: TokenSubject,
    refreshToken: string,
  ): Promise<AuthTokens> {
    const payload: AccessTokenPayload = {
      sub: subject.userId,
      companyId: subject.companyId,
      roles: subject.roles,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessTtlSeconds,
    });
    return { accessToken, expiresIn: this.accessTtlSeconds, refreshToken };
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
