import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { UniqueViolationError } from '../common/unique-violation.error.js';
import {
  type Transaction,
  TransactionRunner,
} from '../database/transaction-runner.js';
import type { RoleName } from './role-name.js';
import { Role } from './role.entity.js';
import { RoleRepository } from './role.repository.js';
import { UserRoleRepository } from './user-role.repository.js';

export interface RoleHolder {
  id: string;
  companyId: string | null;
}

const DEFAULT_NEW_USER_ROLES: RoleName[] = ['VIEWER'];

@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly transactions: TransactionRunner,
  ) {}

  listRoles(): Promise<Role[]> {
    return this.roles.findAllByName();
  }

  async getUserRoles(userId: string): Promise<RoleName[]> {
    const mappings = await this.userRoles.findByUser(userId);
    return mappings.map((m) => m.role!.name).sort();
  }

  /** Roles of many users in one query, as userId → sorted role names ([] if none). */
  async getRolesForUsers(userIds: string[]): Promise<Map<string, RoleName[]>> {
    const byUser = new Map<string, RoleName[]>(userIds.map((id) => [id, []]));
    for (const mapping of await this.userRoles.findByUsers(userIds)) {
      byUser.get(mapping.userId)?.push(mapping.role!.name);
    }
    for (const names of byUser.values()) {
      names.sort();
    }
    return byUser;
  }

  async removeAllRolesForUsers(
    userIds: string[],
    tx: Transaction,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    await this.userRoles.withTransaction(tx).softDeleteByUserIds(userIds);
  }

  getUserIdsWithRole(name: RoleName): Promise<string[]> {
    return this.userRoles.findUserIdsWithRole(name);
  }

  // Throws 400 unless the roles fit the user's company:
  // a user without a company may only be PLATFORM_ADMIN,
  // a user with a company may hold any role except PLATFORM_ADMIN.
  resolveNewUserRoles(
    companyId: string | null,
    requested?: RoleName[],
  ): RoleName[] {
    const names = requested ?? DEFAULT_NEW_USER_ROLES;
    this.assertRolesFitUser(companyId, names);
    return names;
  }

  assertRolesFitUser(companyId: string | null, names: RoleName[]): void {
    if (names.length === 0) {
      throw new BadRequestException('A user must have at least one role');
    }
    const isPlatformUser = companyId === null;
    for (const name of names) {
      if (isPlatformUser && name !== 'PLATFORM_ADMIN') {
        throw new BadRequestException(
          `${name} requires a company; a user without a company can only be PLATFORM_ADMIN`,
        );
      }
      if (!isPlatformUser && name === 'PLATFORM_ADMIN') {
        throw new BadRequestException(
          'PLATFORM_ADMIN is only for users without a company',
        );
      }
    }
  }

  /** 409 if the user is the last admin among peerIds (COMPANY_ADMIN in a company, PLATFORM_ADMIN otherwise). */
  async assertNotLastAdmin(
    user: RoleHolder,
    peerIds: string[],
    tx: Transaction,
  ): Promise<void> {
    const adminRole: RoleName = user.companyId
      ? 'COMPANY_ADMIN'
      : 'PLATFORM_ADMIN';
    const userRoles = this.userRoles.withTransaction(tx);
    const isAdmin =
      (await userRoles.countUsersWithRole(adminRole, [user.id])) > 0;
    if (!isAdmin) {
      return;
    }
    const others = await userRoles.countUsersWithRole(
      adminRole,
      peerIds.filter((id) => id !== user.id),
    );
    if (others === 0) {
      throw new ConflictException(
        user.companyId
          ? 'Company must keep at least one admin'
          : 'The platform must keep at least one platform admin',
      );
    }
  }

  async replaceUserRoles(
    user: RoleHolder,
    names: RoleName[],
    tx?: Transaction,
    companyUserIds: string[] = [],
  ): Promise<RoleName[]> {
    this.assertRolesFitUser(user.companyId, names);
    const wanted = [...new Set(names)];

    const work = async (t: Transaction): Promise<RoleName[]> => {
      const roles = this.roles.withTransaction(t);
      const userRoles = this.userRoles.withTransaction(t);

      const wantedRoles = await roles.findByNames(wanted);
      if (wantedRoles.length !== wanted.length) {
        throw new Error(
          `Role rows missing in the database for: ${wanted.join(', ')}`,
        );
      }
      const wantedIds = new Set(wantedRoles.map((r) => r.id));

      const current = await userRoles.findByUser(user.id);
      const currentIds = new Set(current.map((m) => m.roleId));

      const losesCompanyAdmin =
        current.some((m) => m.role?.name === 'COMPANY_ADMIN') &&
        !wanted.includes('COMPANY_ADMIN');
      if (losesCompanyAdmin) {
        const otherAdmins = await userRoles.countUsersWithRole(
          'COMPANY_ADMIN',
          companyUserIds.filter((id) => id !== user.id),
        );
        if (otherAdmins === 0) {
          throw new ConflictException('Company must keep at least one admin');
        }
      }

      for (const mapping of current) {
        if (!wantedIds.has(mapping.roleId)) {
          await userRoles.softDelete(mapping);
        }
      }
      for (const role of wantedRoles) {
        if (!currentIds.has(role.id)) {
          await userRoles.save(
            userRoles.create({ userId: user.id, roleId: role.id }),
          );
        }
      }
      return wanted.sort();
    };

    try {
      return await (tx ? work(tx) : this.transactions.run(work));
    } catch (error) {
      if (error instanceof UniqueViolationError) {
        throw new ConflictException(
          "This user's roles were changed at the same time. Please try again.",
        );
      }
      throw error;
    }
  }
}
