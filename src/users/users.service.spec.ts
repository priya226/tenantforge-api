import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';

import { CompaniesService } from '../companies/companies.service.js';
import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';
import { UsersService } from './users.service.js';

// Real argon2, but verify is wrapped in a spy so the timing-defense test can check it was called.
// (ESM module exports can't be spied on directly with vi.spyOn.)
vi.mock('argon2', async (importOriginal) => {
  const real = await importOriginal<typeof import('argon2')>();
  return { ...real, verify: vi.fn(real.verify) };
});

const COMPANY_ID = '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const USER_ID = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PASSWORD = 'correct horse battery';

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
  // Fake UserRepository. The real queries (isDeleted filter, loading the hash) were checked against Postgres.
  const repo = {
    findOneBy: vi.fn(),
    findByEmail: vi.fn(),
    findForLogin: vi.fn(),
    create: vi.fn((data: Partial<User>) => Object.assign(new User(), data)),
    save: vi.fn((user: User) => Promise.resolve(user)),
  };
  const companiesService = { findOne: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    companiesService.findOne.mockResolvedValue({ id: COMPANY_ID });
    repo.findByEmail.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UserRepository, useValue: repo },
        { provide: CompaniesService, useValue: companiesService },
      ],
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
    it('saves a normalized email and an argon2 hash, and returns the user without the hash', async () => {
      // The service strips the hash from the saved object afterwards, so copy what save() received.
      let saved: Partial<User> = {};
      repo.save.mockImplementationOnce((user: User) => {
        saved = { email: user.email, passwordHash: user.passwordHash };
        return Promise.resolve(user);
      });

      const created = await service.create(input);

      expect(saved.email).toBe('priya@acme.com');
      expect(saved.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await argon2.verify(saved.passwordHash!, PASSWORD)).toBe(true);
      expect(created).not.toHaveProperty('passwordHash');
    });

    it('rejects an unknown company before touching users', async () => {
      companiesService.findOne.mockRejectedValue(new NotFoundException());

      await expect(service.create(input)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findByEmail).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email is already taken', async () => {
      repo.findByEmail.mockResolvedValue(makeUser());

      await expect(service.create(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('turns a unique-index violation (two sign-ups at once) into ConflictException', async () => {
      repo.save.mockRejectedValueOnce(
        new QueryFailedError('INSERT ...', [], { code: '23505' } as never),
      );

      await expect(service.create(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows other database errors unchanged', async () => {
      const error = new QueryFailedError('INSERT ...', [], {
        code: '23503',
      } as never);
      repo.save.mockRejectedValueOnce(error);

      await expect(service.create(input)).rejects.toBe(error);
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
