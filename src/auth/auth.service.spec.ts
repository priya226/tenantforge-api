import { createHash, randomUUID } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { TransactionRunner } from '../database/transaction-runner.js';
import { AuthService, type TokenSubject } from './auth.service.js';
import { RefreshToken } from './refresh-token.entity.js';
import type { RefreshTokenRepository } from './refresh-token.repository.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-01T10:00:00Z');
const SECRET = 'test-secret-test-secret-test-secret';

const subject: TokenSubject = {
  userId: '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  companyId: '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f',
  roles: ['COMPANY_ADMIN'],
};

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

class FakeRefreshTokens {
  rows: RefreshToken[] = [];
  loseNextRace = false;

  create = (data: Partial<RefreshToken>) =>
    Object.assign(new RefreshToken(), data);

  save = (token: RefreshToken) => {
    token.id ??= randomUUID();
    this.rows.push(token);
    return Promise.resolve(token);
  };

  findByHash = (hash: string) =>
    Promise.resolve(this.rows.find((r) => r.tokenHash === hash) ?? null);

  markReplaced = vi.fn((id: string, replacedById: string, at: Date) => {
    const row = this.rows.find((r) => r.id === id && !r.revokedAt);
    if (!row || this.loseNextRace) {
      return Promise.resolve(false);
    }
    Object.assign(row, { revokedAt: at, replacedById });
    return Promise.resolve(true);
  });

  revokeFamily = vi.fn((familyId: string, at: Date) => {
    const active = this.rows.filter(
      (r) => r.familyId === familyId && !r.revokedAt,
    );
    active.forEach((r) => (r.revokedAt = at));
    return Promise.resolve(active.length);
  });

  withTransaction = () => this;
}

const config = {
  getOrThrow: (key: string) =>
    ({
      JWT_ACCESS_TTL_SECONDS: '900',
      REFRESH_IDLE_DAYS: '7',
      REFRESH_ABSOLUTE_DAYS: '30',
    })[key],
} as unknown as ConfigService;

const transactions = {
  run: <T>(work: (tx: unknown) => Promise<T>) => work('tx'),
} as unknown as TransactionRunner;

describe('AuthService', () => {
  let tokens: FakeRefreshTokens;
  let jwt: JwtService;
  let service: AuthService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    tokens = new FakeRefreshTokens();
    jwt = new JwtService({ secret: SECRET });
    service = new AuthService(
      tokens as unknown as RefreshTokenRepository,
      jwt,
      transactions,
      config,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startSession', () => {
    it('returns a JWT with sub, companyId and roles only, and a 900 s lifetime', async () => {
      const result = await service.startSession(subject);

      const payload = await service.verifyAccessToken(result.accessToken);
      expect(payload).toMatchObject({
        sub: subject.userId,
        companyId: subject.companyId,
        roles: ['COMPANY_ADMIN'],
      });
      expect(Object.keys(payload).sort()).toEqual(
        ['companyId', 'exp', 'iat', 'roles', 'sub'].sort(),
      );
      expect(payload.exp - payload.iat).toBe(900);
      expect(result.expiresIn).toBe(900);
    });

    it('stores only the SHA-256 of the refresh token, with 7-day and 30-day expiries', async () => {
      const { refreshToken } = await service.startSession(subject);

      expect(tokens.rows).toHaveLength(1);
      const row = tokens.rows[0];
      expect(row.tokenHash).toBe(sha256(refreshToken));
      expect(row.tokenHash).not.toContain(refreshToken);
      expect(row.expiresAt).toEqual(new Date(NOW.getTime() + 7 * DAY));
      expect(row.familyExpiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
      expect(row.revokedAt).toBeNull();
    });

    it('starts a new family for every login', async () => {
      await service.startSession(subject);
      await service.startSession(subject);

      expect(tokens.rows[0].familyId).not.toBe(tokens.rows[1].familyId);
    });
  });

  describe('findSession', () => {
    it('rejects an unknown token with 401', async () => {
      await expect(service.findSession('nope')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token with 401 without revoking the family', async () => {
      const { refreshToken } = await service.startSession(subject);
      vi.setSystemTime(new Date(NOW.getTime() + 7 * DAY));

      await expect(service.findSession(refreshToken)).rejects.toThrow(
        'Session expired',
      );
      expect(tokens.revokeFamily).not.toHaveBeenCalled();
    });

    it('treats a revoked token as reuse: revokes the whole family and returns 401', async () => {
      const first = await service.startSession(subject);
      const session = await service.findSession(first.refreshToken);
      const second = await service.rotate(session, subject);

      await expect(service.findSession(first.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokens.revokeFamily).toHaveBeenCalledWith(
        session.familyId,
        expect.any(Date),
      );
      await expect(service.findSession(second.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('rotate', () => {
    it('revokes the old token, links it to the new one and keeps the family', async () => {
      const first = await service.startSession(subject);
      const old = await service.findSession(first.refreshToken);

      const next = await service.rotate(old, subject);

      const newRow = tokens.rows.find(
        (r) => r.tokenHash === sha256(next.refreshToken),
      );
      expect(newRow?.familyId).toBe(old.familyId);
      expect(newRow?.familyExpiresAt).toEqual(old.familyExpiresAt);
      expect(old.revokedAt).toEqual(NOW);
      expect(old.replacedById).toBe(newRow?.id);
      expect(next.refreshToken).not.toBe(first.refreshToken);
    });

    it('slides the idle expiry but never past the 30-day family cap', async () => {
      const first = await service.startSession(subject);
      const old = await service.findSession(first.refreshToken);
      vi.setSystemTime(new Date(NOW.getTime() + 27 * DAY));

      const next = await service.rotate(old, subject);

      const newRow = tokens.rows.find(
        (r) => r.tokenHash === sha256(next.refreshToken),
      );
      expect(newRow?.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    });

    it('puts the fresh roles into the new access token', async () => {
      const first = await service.startSession(subject);
      const old = await service.findSession(first.refreshToken);

      const next = await service.rotate(old, { ...subject, roles: ['VIEWER'] });

      const payload = await service.verifyAccessToken(next.accessToken);
      expect(payload.roles).toEqual(['VIEWER']);
    });

    it('ends the session when another refresh already rotated the same token', async () => {
      const first = await service.startSession(subject);
      const old = await service.findSession(first.refreshToken);
      tokens.loseNextRace = true;

      await expect(service.rotate(old, subject)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokens.revokeFamily).toHaveBeenCalledWith(
        old.familyId,
        expect.any(Date),
      );
    });
  });

  describe('logout', () => {
    it('revokes only the family of the given token', async () => {
      const laptop = await service.startSession(subject);
      const phone = await service.startSession(subject);

      await service.logout(laptop.refreshToken);

      await expect(service.findSession(laptop.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(
        service.findSession(phone.refreshToken),
      ).resolves.toBeInstanceOf(RefreshToken);
    });

    it('does nothing for an unknown token', async () => {
      await expect(service.logout('nope')).resolves.toBeUndefined();
      expect(tokens.revokeFamily).not.toHaveBeenCalled();
    });
  });

  it('rejects an access token signed with another secret', async () => {
    const forged = await new JwtService({ secret: 'other-secret' }).signAsync({
      sub: subject.userId,
    });

    await expect(service.verifyAccessToken(forged)).rejects.toThrow();
  });
});
