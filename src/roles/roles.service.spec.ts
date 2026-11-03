import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { UniqueViolationError } from '../common/unique-violation.error.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import type { RoleName } from './role-name.js';
import { Role } from './role.entity.js';
import { RoleRepository } from './role.repository.js';
import { RolesService } from './roles.service.js';
import { UserRole } from './user-role.entity.js';
import { UserRoleRepository } from './user-role.repository.js';

const USER_ID = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const COMPANY_ID = '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const companyUser = { id: USER_ID, companyId: COMPANY_ID };
const platformUser = { id: USER_ID, companyId: null };

const ROLES: Record<RoleName, Role> = {
  PLATFORM_ADMIN: Object.assign(new Role(), {
    id: 'r-pa',
    name: 'PLATFORM_ADMIN',
  }),
  COMPANY_ADMIN: Object.assign(new Role(), {
    id: 'r-ca',
    name: 'COMPANY_ADMIN',
  }),
  VIEWER: Object.assign(new Role(), { id: 'r-v', name: 'VIEWER' }),
};

function mapping(name: RoleName): UserRole {
  return Object.assign(new UserRole(), {
    id: `m-${name}`,
    userId: USER_ID,
    roleId: ROLES[name].id,
    role: ROLES[name],
  });
}

describe('RolesService', () => {
  let service: RolesService;

  const roles = {
    findByNames: vi.fn((names: RoleName[]) =>
      Promise.resolve(names.map((n) => ROLES[n])),
    ),
    findAllByName: vi.fn(() =>
      Promise.resolve([
        ROLES.COMPANY_ADMIN,
        ROLES.PLATFORM_ADMIN,
        ROLES.VIEWER,
      ]),
    ),
    withTransaction: vi.fn(),
  };
  const userRoles = {
    findByUser: vi.fn(),
    findByUsers: vi.fn(),
    create: vi.fn((data: Partial<UserRole>) =>
      Object.assign(new UserRole(), data),
    ),
    save: vi.fn((m: UserRole) => Promise.resolve(m)),
    softDelete: vi.fn(),
    countUsersWithRole: vi.fn(),
    withTransaction: vi.fn(),
  };
  const transactions = {
    run: vi.fn((work: (tx: unknown) => Promise<unknown>) => work('own-tx')),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    roles.withTransaction.mockReturnValue(roles);
    userRoles.withTransaction.mockReturnValue(userRoles);
    userRoles.findByUser.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: RoleRepository, useValue: roles },
        { provide: UserRoleRepository, useValue: userRoles },
        { provide: TransactionRunner, useValue: transactions },
      ],
    }).compile();
    service = moduleRef.get(RolesService);
  });

  describe('assertNotLastAdmin (deleting a user)', () => {
    const OTHER = 'other-user';
    const TXN = 'tx' as never;

    it('allows deleting a user who is not an admin', async () => {
      userRoles.countUsersWithRole.mockResolvedValueOnce(0);

      await service.assertNotLastAdmin(companyUser, [USER_ID, OTHER], TXN);

      expect(userRoles.countUsersWithRole).toHaveBeenCalledOnce();
      expect(userRoles.countUsersWithRole).toHaveBeenCalledWith(
        'COMPANY_ADMIN',
        [USER_ID],
      );
    });

    it('allows deleting an admin when another admin remains', async () => {
      userRoles.countUsersWithRole
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      await service.assertNotLastAdmin(companyUser, [USER_ID, OTHER], TXN);

      expect(userRoles.countUsersWithRole).toHaveBeenLastCalledWith(
        'COMPANY_ADMIN',
        [OTHER],
      );
    });

    it('rejects deleting the last company admin with 409', async () => {
      userRoles.countUsersWithRole
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await expect(
        service.assertNotLastAdmin(companyUser, [USER_ID, OTHER], TXN),
      ).rejects.toThrow('Company must keep at least one admin');
    });

    it('checks PLATFORM_ADMIN for a user without a company', async () => {
      userRoles.countUsersWithRole
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await expect(
        service.assertNotLastAdmin(platformUser, [USER_ID], TXN),
      ).rejects.toThrow('The platform must keep at least one platform admin');
      expect(userRoles.countUsersWithRole).toHaveBeenCalledWith(
        'PLATFORM_ADMIN',
        [USER_ID],
      );
    });
  });

  describe('last company admin', () => {
    const OTHER_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

    it('rejects removing COMPANY_ADMIN from the last admin with 409', async () => {
      userRoles.findByUser.mockResolvedValue([mapping('COMPANY_ADMIN')]);
      userRoles.countUsersWithRole.mockResolvedValue(0);

      await expect(
        service.replaceUserRoles(companyUser, ['VIEWER'], 'tx' as never, [
          USER_ID,
          OTHER_ID,
        ]),
      ).rejects.toThrow('Company must keep at least one admin');
      expect(userRoles.countUsersWithRole).toHaveBeenCalledWith(
        'COMPANY_ADMIN',
        [OTHER_ID],
      );
      expect(userRoles.softDelete).not.toHaveBeenCalled();
      expect(userRoles.save).not.toHaveBeenCalled();
    });

    it('allows the demotion while another admin remains', async () => {
      userRoles.findByUser.mockResolvedValue([mapping('COMPANY_ADMIN')]);
      userRoles.countUsersWithRole.mockResolvedValue(1);

      await expect(
        service.replaceUserRoles(companyUser, ['VIEWER'], 'tx' as never, [
          USER_ID,
          OTHER_ID,
        ]),
      ).resolves.toEqual(['VIEWER']);
      expect(userRoles.softDelete).toHaveBeenCalledOnce();
    });

    it('does not count admins when the user keeps COMPANY_ADMIN', async () => {
      userRoles.findByUser.mockResolvedValue([mapping('COMPANY_ADMIN')]);

      await service.replaceUserRoles(
        companyUser,
        ['COMPANY_ADMIN', 'VIEWER'],
        'tx' as never,
        [USER_ID],
      );
      expect(userRoles.countUsersWithRole).not.toHaveBeenCalled();
    });
  });

  describe('getRolesForUsers', () => {
    it('groups roles per user in one query, sorted, with [] for users without roles', async () => {
      userRoles.findByUsers.mockResolvedValue([
        Object.assign(mapping('VIEWER'), { userId: 'u1' }),
        Object.assign(mapping('COMPANY_ADMIN'), { userId: 'u1' }),
        Object.assign(mapping('VIEWER'), { userId: 'u2' }),
      ]);

      const result = await service.getRolesForUsers(['u1', 'u2', 'u3']);

      expect(userRoles.findByUsers).toHaveBeenCalledOnce();
      expect(userRoles.findByUsers).toHaveBeenCalledWith(['u1', 'u2', 'u3']);
      expect(result.get('u1')).toEqual(['COMPANY_ADMIN', 'VIEWER']);
      expect(result.get('u2')).toEqual(['VIEWER']);
      expect(result.get('u3')).toEqual([]);
    });
  });

  describe('listRoles', () => {
    it('returns every role from the repository, sorted by name', async () => {
      await expect(service.listRoles()).resolves.toEqual([
        ROLES.COMPANY_ADMIN,
        ROLES.PLATFORM_ADMIN,
        ROLES.VIEWER,
      ]);
      expect(roles.findAllByName).toHaveBeenCalledOnce();
    });
  });

  describe('assertRolesFitUser', () => {
    it('rejects an empty role list', () => {
      expect(() => service.assertRolesFitUser(COMPANY_ID, [])).toThrow(
        BadRequestException,
      );
    });

    it('rejects PLATFORM_ADMIN for a user with a company', () => {
      expect(() =>
        service.assertRolesFitUser(COMPANY_ID, ['PLATFORM_ADMIN']),
      ).toThrow(BadRequestException);
    });

    it('rejects company roles for a user without a company', () => {
      expect(() => service.assertRolesFitUser(null, ['VIEWER'])).toThrow(
        BadRequestException,
      );
    });

    it('accepts valid combinations', () => {
      expect(() =>
        service.assertRolesFitUser(COMPANY_ID, ['COMPANY_ADMIN', 'VIEWER']),
      ).not.toThrow();
      expect(() =>
        service.assertRolesFitUser(null, ['PLATFORM_ADMIN']),
      ).not.toThrow();
    });
  });

  describe('resolveNewUserRoles', () => {
    it('gives VIEWER when no roles are requested', () => {
      expect(service.resolveNewUserRoles(COMPANY_ID)).toEqual(['VIEWER']);
    });

    it('keeps the requested roles when they fit', () => {
      expect(
        service.resolveNewUserRoles(COMPANY_ID, ['COMPANY_ADMIN']),
      ).toEqual(['COMPANY_ADMIN']);
    });

    it('rejects requested roles that do not fit the company', () => {
      expect(() =>
        service.resolveNewUserRoles(COMPANY_ID, ['PLATFORM_ADMIN']),
      ).toThrow(BadRequestException);
    });

    it('rejects the VIEWER default for a user without a company', () => {
      expect(() => service.resolveNewUserRoles(null)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('replaceUserRoles', () => {
    it('adds new roles, soft-deletes removed ones, and leaves kept ones alone', async () => {
      const viewer = mapping('VIEWER');
      userRoles.findByUser.mockResolvedValue([viewer]);

      const result = await service.replaceUserRoles(companyUser, [
        'COMPANY_ADMIN',
      ]);

      expect(result).toEqual(['COMPANY_ADMIN']);
      expect(userRoles.softDelete).toHaveBeenCalledWith(viewer);
      expect(userRoles.save).toHaveBeenCalledOnce();
      expect(userRoles.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, roleId: 'r-ca' }),
      );
    });

    it('does nothing when the roles are unchanged (duplicates in the input are ignored)', async () => {
      userRoles.findByUser.mockResolvedValue([mapping('VIEWER')]);

      const result = await service.replaceUserRoles(companyUser, [
        'VIEWER',
        'VIEWER',
      ]);

      expect(result).toEqual(['VIEWER']);
      expect(userRoles.save).not.toHaveBeenCalled();
      expect(userRoles.softDelete).not.toHaveBeenCalled();
    });

    it('opens its own transaction when none is passed', async () => {
      await service.replaceUserRoles(companyUser, ['VIEWER']);

      expect(transactions.run).toHaveBeenCalledOnce();
      expect(userRoles.withTransaction).toHaveBeenCalledWith('own-tx');
    });

    it("joins the caller's transaction when one is passed", async () => {
      const callerTx = 'caller-tx' as never;

      await service.replaceUserRoles(
        platformUser,
        ['PLATFORM_ADMIN'],
        callerTx,
      );

      expect(transactions.run).not.toHaveBeenCalled();
      expect(userRoles.withTransaction).toHaveBeenCalledWith(callerTx);
    });

    it('checks the company rule before touching the database', async () => {
      await expect(
        service.replaceUserRoles(companyUser, ['PLATFORM_ADMIN']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transactions.run).not.toHaveBeenCalled();
    });

    it('turns a unique-index violation (concurrent change) into ConflictException', async () => {
      userRoles.save.mockRejectedValueOnce(new UniqueViolationError());

      await expect(
        service.replaceUserRoles(companyUser, ['VIEWER']),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('getUserRoles returns the role names sorted', async () => {
    userRoles.findByUser.mockResolvedValue([
      mapping('VIEWER'),
      mapping('COMPANY_ADMIN'),
    ]);

    expect(await service.getUserRoles(USER_ID)).toEqual([
      'COMPANY_ADMIN',
      'VIEWER',
    ]);
  });
});
