import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import { FeatureFlag } from '../flags/feature-flag.entity.js';
import { FlagsService } from '../flags/flags.service.js';
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

const admin = {
  userId: 'admin-1',
  companyId: COMPANY_ID,
  roles: ['COMPANY_ADMIN' as const],
};
const SCOPE = { kind: 'company', companyId: COMPANY_ID };

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
    search: vi.fn(),
    rename: vi.fn(),
    assertCanDelete: vi.fn(),
    remove: vi.fn(() => {
      calls.push('remove-user');
      return Promise.resolve();
    }),
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
    getRolesForUsers: vi.fn(),
    assertNotLastAdmin: vi.fn(() => {
      calls.push('last-admin-check');
      return Promise.resolve();
    }),
    getUserIdsWithRole: vi.fn(),
    removeAllRolesForUsers: vi.fn(() => {
      calls.push('roles');
      return Promise.resolve();
    }),
  };
  const makeFlag = (version = 1) =>
    Object.assign(new FeatureFlag(), {
      id: 'flag-1',
      companyId: COMPANY_ID,
      key: 'new-checkout',
      version,
    });
  const flags = {
    resolveCompany: vi.fn(() => COMPANY_ID),
    list: vi.fn(),
    findByKey: vi.fn(() => Promise.resolve(makeFlag(1))),
    create: vi.fn(() => {
      calls.push('create-flag');
      return Promise.resolve(makeFlag(1));
    }),
    update: vi.fn(() => {
      calls.push('update-flag');
      return Promise.resolve(makeFlag(2));
    }),
    remove: vi.fn(() => {
      calls.push('remove-flag');
      return Promise.resolve(2);
    }),
    softDeleteByCompany: vi.fn(() => {
      calls.push('flags');
      return Promise.resolve();
    }),
    snapshot: vi.fn((f: FeatureFlag) => ({ key: f.key, version: f.version })),
  };
  const audit = {
    record: vi.fn(() => {
      calls.push('audit');
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
    tenantScope: vi.fn(() => SCOPE),
    revokeAllForUser: vi.fn(() => {
      calls.push('revoke-sessions');
      return Promise.resolve();
    }),
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
        { provide: FlagsService, useValue: flags },
        { provide: AuditService, useValue: audit },
        { provide: TransactionRunner, useValue: transactions },
      ],
    }).compile();
    facade = moduleRef.get(FeatureFlagFacade);
  });

  describe('removeCompany', () => {
    it('deletes the company, its users, their roles and its flags, in one transaction', async () => {
      await facade.removeCompany(COMPANY_ID);

      expect(transactions.run).toHaveBeenCalledOnce();
      expect(calls).toEqual(['company', 'users', 'roles', 'flags']);
      expect(flags.softDeleteByCompany).toHaveBeenCalledWith(COMPANY_ID, 'tx');
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
      const created = await facade.createUser(admin, newUser);

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
      const created = await facade.createUser(admin, {
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

      await expect(facade.createUser(admin, newUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(roles.resolveNewUserRoles).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
    });

    it('stops when the roles are rejected, before opening a transaction', async () => {
      roles.resolveNewUserRoles.mockImplementationOnce(() => {
        throw new BadRequestException();
      });

      await expect(facade.createUser(admin, newUser)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(transactions.run).not.toHaveBeenCalled();
    });
  });

  describe('ensurePlatformAdmin (seed:admin)', () => {
    const newAdmin = {
      name: 'Platform Admin',
      email: 'admin@tenantforge.local',
      password: 'correct horse battery',
    };

    it('creates a PLATFORM_ADMIN without a company when no active admin exists', async () => {
      roles.getUserIdsWithRole.mockResolvedValue([USER_ID]);
      users.anyActive.mockResolvedValue(false);

      expect(await facade.ensurePlatformAdmin(newAdmin)).toBe('created');
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

      expect(await facade.ensurePlatformAdmin(newAdmin)).toBe('already-exists');
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('user roles', () => {
    it('setUserRoles stops at 404 for an unknown user without touching roles', async () => {
      users.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        facade.setUserRoles(admin, USER_ID, ['VIEWER']),
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

      expect(
        await facade.setUserRoles(admin, USER_ID, ['COMPANY_ADMIN']),
      ).toEqual(['COMPANY_ADMIN']);
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

      await facade.setUserRoles(admin, USER_ID, ['PLATFORM_ADMIN']);

      expect(companies.lockForUpdate).not.toHaveBeenCalled();
      expect(roles.replaceUserRoles).toHaveBeenCalledWith(
        user,
        ['PLATFORM_ADMIN'],
        'tx',
        [],
      );
    });
  });

  describe('tenant scope', () => {
    it('createUser checks the company inside the caller scope', async () => {
      await facade.createUser(admin, newUser);

      expect(auth.tenantScope).toHaveBeenCalledWith(admin);
      expect(companies.findOne).toHaveBeenCalledWith(COMPANY_ID, SCOPE);
    });

    it('findUser, getUserRoles and setUserRoles look the user up inside the caller scope', async () => {
      users.findOne.mockResolvedValue(makeUser());
      roles.getUserRoles.mockResolvedValue(['VIEWER']);

      await facade.findUser(admin, USER_ID);
      await facade.getUserRoles(admin, USER_ID);
      await facade.setUserRoles(admin, USER_ID, ['VIEWER']);

      expect(users.findOne).toHaveBeenCalledTimes(3);
      for (const call of users.findOne.mock.calls) {
        expect(call).toEqual([USER_ID, SCOPE]);
      }
    });

    it('a user outside the scope is a 404 and nothing else runs', async () => {
      users.findOne.mockRejectedValue(new NotFoundException());

      await expect(facade.findUser(admin, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(roles.getUserRoles).not.toHaveBeenCalled();
    });
  });

  describe('removeUser', () => {
    it('locks the company, checks the last admin, then deletes user, roles and sessions in one transaction', async () => {
      const user = makeUser();
      users.findOne.mockResolvedValue(user);

      await facade.removeUser(admin, USER_ID);

      expect(users.findOne).toHaveBeenCalledWith(USER_ID, SCOPE);
      expect(users.assertCanDelete).toHaveBeenCalledWith(admin.userId, user);
      expect(transactions.run).toHaveBeenCalledOnce();
      expect(calls).toEqual([
        'lock',
        'company-users',
        'last-admin-check',
        'remove-user',
        'roles',
        'revoke-sessions',
      ]);
      expect(roles.assertNotLastAdmin).toHaveBeenCalledWith(
        user,
        [USER_ID, 'u2'],
        'tx',
      );
      expect(roles.removeAllRolesForUsers).toHaveBeenCalledWith(
        [USER_ID],
        'tx',
      );
      expect(auth.revokeAllForUser).toHaveBeenCalledWith(USER_ID, 'tx');
    });

    it('does not lock a company for a platform user', async () => {
      users.findOne.mockResolvedValue(makeUser(null));

      await facade.removeUser(admin, USER_ID);

      expect(companies.lockForUpdate).not.toHaveBeenCalled();
      expect(users.findIdsInCompany).toHaveBeenCalledWith(null, 'tx');
    });

    it('stops before the transaction when deleting yourself', async () => {
      users.findOne.mockResolvedValue(makeUser());
      users.assertCanDelete.mockImplementationOnce(() => {
        throw new BadRequestException();
      });

      await expect(facade.removeUser(admin, USER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(transactions.run).not.toHaveBeenCalled();
    });

    it('deletes nothing when the last-admin check fails', async () => {
      users.findOne.mockResolvedValue(makeUser());
      roles.assertNotLastAdmin.mockRejectedValueOnce(new ConflictException());

      await expect(facade.removeUser(admin, USER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(users.remove).not.toHaveBeenCalled();
      expect(auth.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('renameUser', () => {
    it('renames inside the caller scope and returns the user with roles', async () => {
      users.rename.mockResolvedValue(makeUser());
      roles.getUserRoles.mockResolvedValue(['VIEWER']);

      const user = await facade.renameUser(admin, USER_ID, 'New');

      expect(users.rename).toHaveBeenCalledWith(USER_ID, SCOPE, 'New');
      expect(user.roles).toEqual(['VIEWER']);
    });
  });

  describe('listUsers', () => {
    it('searches in the caller scope and attaches roles loaded for the whole page', async () => {
      const a = Object.assign(makeUser(), { id: 'u1' });
      const b = Object.assign(makeUser(), { id: 'u2' });
      users.search.mockResolvedValue({ items: [a, b], total: 7 });
      roles.getRolesForUsers.mockResolvedValue(
        new Map([
          ['u1', ['COMPANY_ADMIN']],
          ['u2', ['VIEWER']],
        ]),
      );
      const query = { limit: 2, offset: 0, q: 'pri' };

      const page = await facade.listUsers(admin, query);

      expect(users.search).toHaveBeenCalledWith(SCOPE, query);
      expect(roles.getRolesForUsers).toHaveBeenCalledWith(['u1', 'u2']);
      expect(page.total).toBe(7);
      expect(page.items.map((u) => [u.id, u.roles])).toEqual([
        ['u1', ['COMPANY_ADMIN']],
        ['u2', ['VIEWER']],
      ]);
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

  describe('flags', () => {
    const state = {
      description: null,
      enabled: true,
      rolloutType: 'PERCENT' as const,
      rolloutValue: 50,
      rules: [],
    };

    it('lists flags of the company resolved from the scope', async () => {
      flags.list.mockResolvedValue([]);

      await facade.listFlags(admin, undefined);

      expect(flags.resolveCompany).toHaveBeenCalledWith(SCOPE, undefined);
      expect(flags.list).toHaveBeenCalledWith(COMPANY_ID);
    });

    it('creates a flag and its CREATE audit row in one transaction', async () => {
      await facade.createFlag(admin, { key: 'new-checkout' });

      expect(transactions.run).toHaveBeenCalledOnce();
      expect(calls).toEqual(['create-flag', 'audit']);
      expect(flags.create).toHaveBeenCalledWith(
        COMPANY_ID,
        { key: 'new-checkout' },
        'tx',
      );
      expect(audit.record).toHaveBeenCalledWith(
        {
          companyId: COMPANY_ID,
          userId: admin.userId,
          entityType: 'FLAG',
          entityId: 'flag-1',
          version: 1,
          action: 'CREATE',
          before: null,
          after: { key: 'new-checkout', version: 1 },
        },
        'tx',
      );
    });

    it('updates a flag and audits before/after at the new version', async () => {
      const updated = await facade.updateFlag(admin, 'new-checkout', 1, state);

      expect(updated.version).toBe(2);
      expect(calls).toEqual(['update-flag', 'audit']);
      expect(flags.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'flag-1' }),
        1,
        state,
        'tx',
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          version: 2,
          before: { key: 'new-checkout', version: 1 },
          after: { key: 'new-checkout', version: 2 },
        }),
        'tx',
      );
    });

    it('writes no audit row when the version check fails', async () => {
      flags.update.mockRejectedValueOnce(new ConflictException());

      await expect(
        facade.updateFlag(admin, 'new-checkout', 1, state),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('deletes a flag and audits DELETE with only a before snapshot', async () => {
      await facade.removeFlag(admin, 'new-checkout', 1);

      expect(calls).toEqual(['remove-flag', 'audit']);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          version: 2,
          before: { key: 'new-checkout', version: 1 },
          after: null,
        }),
        'tx',
      );
    });

    it('stops at 404 before opening a transaction when the flag is missing', async () => {
      flags.findByKey.mockRejectedValueOnce(new NotFoundException());

      await expect(
        facade.removeFlag(admin, 'missing', 1),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(transactions.run).not.toHaveBeenCalled();
    });
  });
});
