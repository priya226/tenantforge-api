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
    search: vi.fn(),
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

      await expect(
        service.findOne(USER_ID, { kind: 'all' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: USER_ID });
    });

    it('adds the caller company to the lookup for a company scope', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.findOne(USER_ID, { kind: 'company', companyId: 'c-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({
        id: USER_ID,
        companyId: 'c-1',
      });
    });
  });

  describe('search', () => {
    const page = { limit: 20, offset: 0 };
    const found = makeUser();

    beforeEach(() => {
      repo.search.mockResolvedValue([[found], 1]);
    });

    it('limits a company scope to that company even without a filter', async () => {
      const result = await service.search(
        { kind: 'company', companyId: COMPANY_ID },
        page,
      );

      expect(repo.search).toHaveBeenCalledWith({
        ...page,
        companyId: COMPANY_ID,
      });
      expect(result).toEqual({ items: [found], total: 1 });
    });

    it('lets the platform scope list every company', async () => {
      await service.search({ kind: 'all' }, { ...page, q: 'pri' });

      expect(repo.search).toHaveBeenCalledWith({
        ...page,
        q: 'pri',
        companyId: undefined,
      });
    });

    it('lets the platform scope filter by any company', async () => {
      await service.search({ kind: 'all' }, { ...page, companyId: 'c-2' });

      expect(repo.search).toHaveBeenCalledWith({ ...page, companyId: 'c-2' });
    });

    it('returns 404 for a company filter outside the scope, without querying', async () => {
      await expect(
        service.search(
          { kind: 'company', companyId: COMPANY_ID },
          { ...page, companyId: 'c-2' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.search).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    const scope = { kind: 'company' as const, companyId: COMPANY_ID };

    it('trims and saves the new name, looking the user up inside the scope', async () => {
      repo.findOneBy.mockResolvedValue(makeUser());

      const user = await service.rename(USER_ID, scope, '  Priya S  ');

      expect(repo.findOneBy).toHaveBeenCalledWith({
        id: USER_ID,
        companyId: COMPANY_ID,
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Priya S' }),
      );
      expect(user.name).toBe('Priya S');
    });

    it('rejects a blank or too long name with 400 before loading the user', async () => {
      await expect(
        service.rename(USER_ID, scope, '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.rename(USER_ID, scope, 'x'.repeat(201)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    it('returns 404 for a user outside the scope', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.rename(USER_ID, scope, 'New'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('assertCanDelete', () => {
    it('rejects deleting your own account with 400', () => {
      expect(() => service.assertCanDelete(USER_ID, makeUser())).toThrow(
        BadRequestException,
      );
    });

    it('allows deleting someone else', () => {
      expect(() =>
        service.assertCanDelete('someone-else', makeUser()),
      ).not.toThrow();
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
