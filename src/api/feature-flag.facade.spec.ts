import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AuthService } from '../auth/auth.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import { RolesService } from '../roles/roles.service.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { FeatureFlagFacade } from './feature-flag.facade.js';

const COMPANY_ID = '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const USER_ID = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const newUser = {
  companyId: COMPANY_ID,
  name: 'Priya',
  email: 'priya@acme.com',
  password: 'correct horse battery',
};

const makeUser = (companyId: string | null = COMPANY_ID) =>
  Object.assign(new User(), { id: USER_ID, companyId, name: 'Priya' });

describe('FeatureFlagFacade', () => {
  let facade: FeatureFlagFacade;
  const calls: string[] = [];

  const companies = {
    findOne: vi.fn(),
    lockForUpdate: vi.fn(() => {
      calls.push('lock');
      return Promise.resolve({ id: COMPANY_ID });
    }),
    remove: vi.fn(() => {
      calls.push('company');
      return Promise.resolve();
    }),
  };
  const users = {
    findOne: vi.fn(),
    create: vi.fn((data: { companyId: string | null }) =>
      Promise.resolve(makeUser(data.companyId)),
    ),
    anyActive: vi.fn(),
    verifyCredentials: vi.fn(),
    findActive: vi.fn(),
    findIdsInCompany: vi.fn(() => {
      calls.push('company-users');
      return Promise.resolve([USER_ID, 'u2']);
    }),
    softDeleteByCompany: vi.fn(() => {
      calls.push('users');
      return Promise.resolve(['u1', 'u2']);
    }),
  };
  const roles = {
    resolveNewUserRoles: vi.fn(
      (_companyId: string | null, requested?: string[]) =>
        requested ?? ['VIEWER'],
    ),
    replaceUserRoles: vi.fn((_user: unknown, names: string[]) =>
      Promise.resolve([...names].sort()),
    ),
    getUserRoles: vi.fn(),
    getUserIdsWithRole: vi.fn(),
    removeAllRolesForUsers: vi.fn(() => {
      calls.push('roles');
      return Promise.resolve();
    }),
  };
  const transactions = {
    run: vi.fn((work: (tx: unknown) => Promise<unknown>) => work('tx')),
  };
  const tokens = { accessToken: 'jwt', expiresIn: 900, refreshToken: 'rt' };
  const session = { id: 's1', userId: USER_ID, familyId: 'f1' };
  const auth = {
    rejectLogin: vi.fn(() => {
      throw new UnauthorizedException();
    }),
    startSession: vi.fn(() => Promise.resolve(tokens)),
    findSession: vi.fn(() => Promise.resolve(session)),
    endSession: vi.fn(() => Promise.reject(new UnauthorizedException())),
    rotate: vi.fn(() => Promise.resolve(tokens)),
    logout: vi.fn(() => Promise.resolve()),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    calls.length = 0;
    companies.findOne.mockResolvedValue({ id: COMPANY_ID });

    const moduleRef = await Test.createTestingModule({
      providers: [
        FeatureFlagFacade,
        { provide: CompaniesService, useValue: companies },
        { provide: UsersService, useValue: users },
        { provide: RolesService, useValue: roles },
        { provide: AuthService, useValue: auth },
        { provide: TransactionRunner, useValue: transactions },
      ],
    }).compile();
    facade = moduleRef.get(FeatureFlagFacade);
  });

  describe('removeCompany', () => {
    it('deletes the company, then its users, then their roles, in one transaction', async () => {
      await facade.removeCompany(COMPANY_ID);

      expect(transactions.run).toHaveBeenCalledOnce();
      expect(calls).toEqual(['company', 'users', 'roles']);
      expect(companies.remove).toHaveBeenCalledWith(COMPANY_ID, 'tx');
      expect(users.softDeleteByCompany).toHaveBeenCalledWith(COMPANY_ID, 'tx');
      expect(roles.removeAllRolesForUsers).toHaveBeenCalledWith(
        ['u1', 'u2'],
        'tx',
      );
    });

    it('stops at 404 when the company does not exist', async () => {
      companies.remove.mockRejectedValueOnce(new NotFoundException());

      await expect(facade.removeCompany(COMPANY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(users.softDeleteByCompany).not.toHaveBeenCalled();
    });
  });

  describe('createUser', () => {
    it('resolves roles, then saves user and roles in one transaction', async () => {
      const created = await facade.createUser(newUser);

      expect(roles.resolveNewUserRoles).toHaveBeenCalledWith(
        COMPANY_ID,
        undefined,
      );
      expect(transactions.run).toHaveBeenCalledOnce();
      expect(users.create).toHaveBeenCalledWith(newUser, 'tx');
      expect(roles.replaceUserRoles).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: COMPANY_ID }),
        ['VIEWER'],
        'tx',
      );
      expect(created.roles).toEqual(['VIEWER']);
    });

    it('passes the requested roles to RolesService', async () => {
      const created = await facade.createUser({
        ...newUser,
        roles: ['COMPANY_ADMIN', 'VIEWER'],
      });

      expect(roles.resolveNewUserRoles).toHaveBeenCalledWith(COMPANY_ID, [
        'COMPANY_ADMIN',
        'VIEWER',
      ]);
      expect(created.roles).toEqual(['COMPANY_ADMIN', 'VIEWER']);
    });

    it('stops at an unknown company before touching roles or users', async () => {
      companies.findOne.mockRejectedValue(new NotFoundException());

      await expect(facade.createUser(newUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(roles.resolveNewUserRoles).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
    });

    it('stops when the roles are rejected, before opening a transaction', async () => {
      roles.resolveNewUserRoles.mockImplementationOnce(() => {
        throw new BadRequestException();
      });

      await expect(facade.createUser(newUser)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(transactions.run).not.toHaveBeenCalled();
    });
  });

  describe('ensurePlatformAdmin (seed:admin)', () => {
    const admin = {
      name: 'Platform Admin',
      email: 'admin@tenantforge.local',
      password: 'correct horse battery',
    };

    it('creates a PLATFORM_ADMIN without a company when no active admin exists', async () => {
      roles.getUserIdsWithRole.mockResolvedValue([USER_ID]);
      users.anyActive.mockResolvedValue(false);

      expect(await facade.ensurePlatformAdmin(admin)).toBe('created');
      expect(users.anyActive).toHaveBeenCalledWith([USER_ID]);
      expect(roles.resolveNewUserRoles).toHaveBeenCalledWith(null, [
        'PLATFORM_ADMIN',
      ]);
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: null }),
        'tx',
      );
      expect(companies.findOne).not.toHaveBeenCalled();
    });

    it('does nothing when an active platform admin already exists', async () => {
      roles.getUserIdsWithRole.mockResolvedValue([USER_ID]);
      users.anyActive.mockResolvedValue(true);

      expect(await facade.ensurePlatformAdmin(admin)).toBe('already-exists');
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('user roles', () => {
    it('setUserRoles stops at 404 for an unknown user without touching roles', async () => {
      users.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        facade.setUserRoles(USER_ID, ['VIEWER']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(roles.replaceUserRoles).not.toHaveBeenCalled();
    });

    it('setUserRoles locks the company, then replaces roles with the company user ids, in one transaction', async () => {
      const user = makeUser();
      users.findOne.mockResolvedValue(user);
      roles.replaceUserRoles.mockImplementationOnce(
        (_user: unknown, names: string[]) => {
          calls.push('roles');
          return Promise.resolve(names);
        },
      );

      expect(await facade.setUserRoles(USER_ID, ['COMPANY_ADMIN'])).toEqual([
        'COMPANY_ADMIN',
      ]);
      expect(calls).toEqual(['lock', 'company-users', 'roles']);
      expect(companies.lockForUpdate).toHaveBeenCalledWith(COMPANY_ID, 'tx');
      expect(roles.replaceUserRoles).toHaveBeenCalledWith(
        user,
        ['COMPANY_ADMIN'],
        'tx',
        [USER_ID, 'u2'],
      );
    });

    it('setUserRoles does not lock anything for a platform user', async () => {
      const user = makeUser(null);
      users.findOne.mockResolvedValue(user);

      await facade.setUserRoles(USER_ID, ['PLATFORM_ADMIN']);

      expect(companies.lockForUpdate).not.toHaveBeenCalled();
      expect(roles.replaceUserRoles).toHaveBeenCalledWith(
        user,
        ['PLATFORM_ADMIN'],
        'tx',
        [],
      );
    });
  });

  describe('auth', () => {
    it('login returns 401 for wrong credentials without starting a session', async () => {
      users.verifyCredentials.mockResolvedValue(null);

      await expect(facade.login('priya@acme.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(roles.getUserRoles).not.toHaveBeenCalled();
      expect(auth.startSession).not.toHaveBeenCalled();
    });

    it('login starts a session with the user id, company and roles', async () => {
      users.verifyCredentials.mockResolvedValue(makeUser());
      roles.getUserRoles.mockResolvedValue(['COMPANY_ADMIN']);

      await expect(facade.login('priya@acme.com', 'pw')).resolves.toBe(tokens);
      expect(auth.startSession).toHaveBeenCalledWith({
        userId: USER_ID,
        companyId: COMPANY_ID,
        roles: ['COMPANY_ADMIN'],
      });
    });

    it('refreshSession rotates with roles reloaded from the database', async () => {
      users.findActive.mockResolvedValue(makeUser());
      roles.getUserRoles.mockResolvedValue(['VIEWER']);

      await expect(facade.refreshSession('rt')).resolves.toBe(tokens);
      expect(auth.findSession).toHaveBeenCalledWith('rt');
      expect(auth.rotate).toHaveBeenCalledWith(session, {
        userId: USER_ID,
        companyId: COMPANY_ID,
        roles: ['VIEWER'],
      });
    });

    it('refreshSession ends the session when the user was deleted', async () => {
      users.findActive.mockResolvedValue(null);

      await expect(facade.refreshSession('rt')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(auth.endSession).toHaveBeenCalledWith(session);
      expect(auth.rotate).not.toHaveBeenCalled();
    });

    it('refreshSession stops when the token is rejected', async () => {
      auth.findSession.mockRejectedValueOnce(new UnauthorizedException());

      await expect(facade.refreshSession('bad')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(users.findActive).not.toHaveBeenCalled();
    });
  });
});
