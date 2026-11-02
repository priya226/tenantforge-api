import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';

import { UniqueViolationError } from '../common/unique-violation.error.js';
import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';
import { UsersService } from './users.service.js';

vi.mock('argon2', async (importOriginal) => {
  const real = await importOriginal<typeof import('argon2')>();
  return { ...real, verify: vi.fn(real.verify) };
});

const COMPANY_ID = '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const USER_ID = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PASSWORD = 'correct horse battery';
const TX = 'tx' as never;

const input = {
  companyId: COMPANY_ID,
  name: 'Priya',
  email: '  Priya@Acme.COM ',
  password: PASSWORD,
};

function makeUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: USER_ID,
    companyId: COMPANY_ID,
    name: 'Priya',
    email: 'priya@acme.com',
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findOneBy: vi.fn(),
    findByEmail: vi.fn(),
    findForLogin: vi.fn(),
    findIdsByCompany: vi.fn(),
    softDeleteBy: vi.fn(),
    create: vi.fn((data: Partial<User>) => Object.assign(new User(), data)),
    save: vi.fn((user: User) => Promise.resolve(user)),
    withTransaction: vi.fn(),
    countByIds: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    repo.findByEmail.mockResolvedValue(null);
    repo.withTransaction.mockReturnValue(repo);

    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: UserRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('findOne', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('saves a normalized email and an argon2 hash in the given transaction, and returns the user without the hash', async () => {
      let saved: Partial<User> = {};
      repo.save.mockImplementationOnce((user: User) => {
        saved = { email: user.email, passwordHash: user.passwordHash };
        return Promise.resolve(user);
      });

      const created = await service.create(input, TX);

      expect(repo.withTransaction).toHaveBeenCalledWith('tx');
      expect(repo.findByEmail).toHaveBeenCalledWith('priya@acme.com');
      expect(saved.email).toBe('priya@acme.com');
      expect(saved.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await argon2.verify(saved.passwordHash!, PASSWORD)).toBe(true);
      expect(created).not.toHaveProperty('passwordHash');
    });

    it('rejects a bad email or a password outside 12-128 characters before saving', async () => {
      await expect(
        service.create({ ...input, email: 'not-an-email' }, TX),
      ).rejects.toThrow(/valid email/);
      await expect(
        service.create({ ...input, password: 'short' }, TX),
      ).rejects.toThrow(/12-128/);
      await expect(
        service.create({ ...input, password: 'x'.repeat(129) }, TX),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email is already taken', async () => {
      repo.findByEmail.mockResolvedValue(makeUser());

      await expect(service.create(input, TX)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('turns a unique-index violation (two sign-ups at once) into ConflictException', async () => {
      repo.save.mockRejectedValueOnce(new UniqueViolationError());

      await expect(service.create(input, TX)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows other database errors unchanged', async () => {
      const error = new Error('connection lost');
      repo.save.mockRejectedValueOnce(error);

      await expect(service.create(input, TX)).rejects.toBe(error);
    });
  });

  describe('anyActive', () => {
    it('returns false for no ids without querying', async () => {
      expect(await service.anyActive([])).toBe(false);
      expect(repo.countByIds).not.toHaveBeenCalled();
    });

    it('is true only when an id belongs to an active user (count skips deleted ones)', async () => {
      repo.countByIds.mockResolvedValueOnce(1);
      expect(await service.anyActive([USER_ID])).toBe(true);
      repo.countByIds.mockResolvedValueOnce(0);
      expect(await service.anyActive([USER_ID])).toBe(false);
    });
  });

  describe('softDeleteByCompany', () => {
    it('soft-deletes the users of the company in the transaction and returns their ids', async () => {
      repo.findIdsByCompany.mockResolvedValue(['u1', 'u2']);

      expect(await service.softDeleteByCompany(COMPANY_ID, TX)).toEqual([
        'u1',
        'u2',
      ]);
      expect(repo.withTransaction).toHaveBeenCalledWith('tx');
      expect(repo.softDeleteBy).toHaveBeenCalledWith({ companyId: COMPANY_ID });
    });
  });

  describe('verifyCredentials', () => {
    let passwordHash: string;
    beforeAll(async () => {
      passwordHash = await argon2.hash(PASSWORD);
    });

    it('returns the user without the hash when the password matches', async () => {
      repo.findForLogin.mockResolvedValue(makeUser({ passwordHash }));

      const user = await service.verifyCredentials('priya@acme.com', PASSWORD);

      expect(user?.id).toBe(USER_ID);
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('normalizes the email before looking the user up', async () => {
      repo.findForLogin.mockResolvedValue(null);

      await service.verifyCredentials('  Priya@ACME.com ', PASSWORD);

      expect(repo.findForLogin).toHaveBeenCalledWith('priya@acme.com');
    });

    it('returns null for a wrong password', async () => {
      repo.findForLogin.mockResolvedValue(makeUser({ passwordHash }));

      expect(
        await service.verifyCredentials('priya@acme.com', 'wrong password!!'),
      ).toBeNull();
    });

    it('returns null for an unknown email, but still runs an argon2 verify (timing defense)', async () => {
      repo.findForLogin.mockResolvedValue(null);
      vi.mocked(argon2.verify).mockClear();

      expect(
        await service.verifyCredentials('nobody@acme.com', PASSWORD),
      ).toBeNull();
      expect(argon2.verify).toHaveBeenCalledOnce();
    });
  });
});
