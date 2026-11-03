import { Injectable } from '@nestjs/common';

import { type AuditPage, AuditService } from '../audit/audit.service.js';
import {
  type AuthTokens,
  AuthService,
  type TokenSubject,
} from '../auth/auth.service.js';
import { ALL_COMPANIES } from '../common/tenant-scope.js';
import {
  type CreateCompanyInput,
  CompaniesService,
  type UpdateCompanyInput,
} from '../companies/companies.service.js';
import { Company } from '../companies/company.entity.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import { FeatureFlag } from '../flags/feature-flag.entity.js';
import {
  type CreateFlagInput,
  type FlagState,
  FlagsService,
} from '../flags/flags.service.js';
import type { RoleName } from '../roles/role-name.js';
import { Role } from '../roles/role.entity.js';
import { RolesService } from '../roles/roles.service.js';
import { User } from '../users/user.entity.js';
import type { UserSearch } from '../users/user-search.js';
import { type NewUser, UsersService } from '../users/users.service.js';

export interface CreateUserRequest {
  companyId: string;
  name: string;
  email: string;
  password: string;
  roles?: RoleName[];
}

export type UserWithRoles = User & { roles: RoleName[] };

export type { AuditPage };

export interface HistoryPage {
  companyId?: string;
  limit: number;
  offset: number;
}

export interface UserListPage {
  items: UserWithRoles[];
  total: number;
}

@Injectable()
export class FeatureFlagFacade {
  constructor(
    private readonly companies: CompaniesService,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly auth: AuthService,
    private readonly flags: FlagsService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRunner,
  ) {}

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.users.verifyCredentials(email, password);
    if (!user) {
      return this.auth.rejectLogin();
    }
    const roles = await this.roles.getUserRoles(user.id);
    return this.auth.startSession({
      userId: user.id,
      companyId: user.companyId,
      roles,
    });
  }

  async refreshSession(refreshToken: string): Promise<AuthTokens> {
    const session = await this.auth.findSession(refreshToken);
    const user = await this.users.findActive(session.userId);
    if (!user) {
      return this.auth.endSession(session);
    }
    const roles = await this.roles.getUserRoles(user.id);
    return this.auth.rotate(session, {
      userId: user.id,
      companyId: user.companyId,
      roles,
    });
  }

  logout(refreshToken: string): Promise<void> {
    return this.auth.logout(refreshToken);
  }

  findAllCompanies(): Promise<Company[]> {
    return this.companies.findAll();
  }

  findCompany(id: string): Promise<Company> {
    return this.companies.findOne(id, ALL_COMPANIES);
  }

  createCompany(input: CreateCompanyInput): Promise<Company> {
    return this.companies.create(input);
  }

  updateCompany(id: string, input: UpdateCompanyInput): Promise<Company> {
    return this.companies.update(id, input);
  }

  async removeCompany(id: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      await this.companies.remove(id, tx);
      const userIds = await this.users.softDeleteByCompany(id, tx);
      await this.roles.removeAllRolesForUsers(userIds, tx);
      await this.flags.softDeleteByCompany(id, tx);
    });
  }

  async createUser(
    actor: TokenSubject,
    input: CreateUserRequest,
  ): Promise<UserWithRoles> {
    const scope = this.auth.tenantScope(actor);
    await this.companies.findOne(input.companyId, scope);
    const roleNames = this.roles.resolveNewUserRoles(
      input.companyId,
      input.roles,
    );
    return this.createUserWithRoles(input, roleNames);
  }

  async ensurePlatformAdmin(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<'created' | 'already-exists'> {
    const adminIds = await this.roles.getUserIdsWithRole('PLATFORM_ADMIN');
    if (await this.users.anyActive(adminIds)) {
      return 'already-exists';
    }
    const roleNames = this.roles.resolveNewUserRoles(null, ['PLATFORM_ADMIN']);
    await this.createUserWithRoles({ ...input, companyId: null }, roleNames);
    return 'created';
  }

  listRoles(): Promise<Role[]> {
    return this.roles.listRoles();
  }

  /** One page of users in the caller's scope, each with its roles. */
  async listUsers(
    actor: TokenSubject,
    input: UserSearch,
  ): Promise<UserListPage> {
    const page = await this.users.search(this.auth.tenantScope(actor), input);
    const rolesByUser = await this.roles.getRolesForUsers(
      page.items.map((u) => u.id),
    );
    return {
      items: page.items.map((u) =>
        Object.assign(u, { roles: rolesByUser.get(u.id) ?? [] }),
      ),
      total: page.total,
    };
  }

  async findUser(actor: TokenSubject, id: string): Promise<UserWithRoles> {
    const user = await this.users.findOne(id, this.auth.tenantScope(actor));
    return Object.assign(user, { roles: await this.roles.getUserRoles(id) });
  }

  /** Renames a user in the caller's scope; returns it with its roles. */
  async renameUser(
    actor: TokenSubject,
    id: string,
    name: string,
  ): Promise<UserWithRoles> {
    const user = await this.users.rename(
      id,
      this.auth.tenantScope(actor),
      name,
    );
    return Object.assign(user, { roles: await this.roles.getUserRoles(id) });
  }

  /** Deletes a user in the caller's scope with its roles and sessions; keeps the last admin. */
  async removeUser(actor: TokenSubject, id: string): Promise<void> {
    const user = await this.users.findOne(id, this.auth.tenantScope(actor));
    this.users.assertCanDelete(actor.userId, user);
    await this.transactions.run(async (tx) => {
      if (user.companyId) {
        await this.companies.lockForUpdate(user.companyId, tx);
      }
      const peerIds = await this.users.findIdsInCompany(user.companyId, tx);
      await this.roles.assertNotLastAdmin(user, peerIds, tx);
      await this.users.remove(user, tx);
      await this.roles.removeAllRolesForUsers([user.id], tx);
      await this.auth.revokeAllForUser(user.id, tx);
    });
  }

  async getUserRoles(actor: TokenSubject, id: string): Promise<RoleName[]> {
    await this.users.findOne(id, this.auth.tenantScope(actor));
    return this.roles.getUserRoles(id);
  }

  async setUserRoles(
    actor: TokenSubject,
    id: string,
    roles: RoleName[],
  ): Promise<RoleName[]> {
    const user = await this.users.findOne(id, this.auth.tenantScope(actor));
    return this.transactions.run(async (tx) => {
      let companyUserIds: string[] = [];
      if (user.companyId) {
        await this.companies.lockForUpdate(user.companyId, tx);
        companyUserIds = await this.users.findIdsInCompany(user.companyId, tx);
      }
      return this.roles.replaceUserRoles(user, roles, tx, companyUserIds);
    });
  }

  /** Flags of the caller's company (or ?companyId for a platform admin), sorted by key. */
  listFlags(actor: TokenSubject, companyId?: string): Promise<FeatureFlag[]> {
    const target = this.flags.resolveCompany(
      this.auth.tenantScope(actor),
      companyId,
    );
    return this.flags.list(target);
  }

  /** One flag by key in the caller's company (or ?companyId for a platform admin). */
  findFlag(
    actor: TokenSubject,
    key: string,
    companyId?: string,
  ): Promise<FeatureFlag> {
    const target = this.flags.resolveCompany(
      this.auth.tenantScope(actor),
      companyId,
    );
    return this.flags.findByKey(target, key);
  }

  /** Creates a flag in the caller's company and its CREATE audit row, in one transaction. */
  createFlag(
    actor: TokenSubject,
    input: CreateFlagInput,
  ): Promise<FeatureFlag> {
    const companyId = this.flags.resolveCompany(this.auth.tenantScope(actor));
    return this.transactions.run(async (tx) => {
      const flag = await this.flags.create(companyId, input, tx);
      await this.audit.record(
        {
          companyId,
          userId: actor.userId,
          entityType: 'FLAG',
          entityId: flag.id,
          version: flag.version,
          action: 'CREATE',
          before: null,
          after: this.flags.snapshot(flag),
        },
        tx,
      );
      return flag;
    });
  }

  /** Replaces a flag's state if expectedVersion still matches (409 otherwise) and audits it. */
  async updateFlag(
    actor: TokenSubject,
    key: string,
    expectedVersion: number,
    input: FlagState,
  ): Promise<FeatureFlag> {
    const companyId = this.flags.resolveCompany(this.auth.tenantScope(actor));
    const flag = await this.flags.findByKey(companyId, key);
    return this.transactions.run(async (tx) => {
      const updated = await this.flags.update(flag, expectedVersion, input, tx);
      await this.audit.record(
        {
          companyId,
          userId: actor.userId,
          entityType: 'FLAG',
          entityId: flag.id,
          version: updated.version,
          action: 'UPDATE',
          before: this.flags.snapshot(flag),
          after: this.flags.snapshot(updated),
        },
        tx,
      );
      return updated;
    });
  }

  /** Soft-deletes a flag if expectedVersion still matches (409 otherwise) and audits it. */
  async removeFlag(
    actor: TokenSubject,
    key: string,
    expectedVersion: number,
  ): Promise<void> {
    const companyId = this.flags.resolveCompany(this.auth.tenantScope(actor));
    const flag = await this.flags.findByKey(companyId, key);
    await this.transactions.run(async (tx) => {
      const version = await this.flags.remove(flag, expectedVersion, tx);
      await this.audit.record(
        {
          companyId,
          userId: actor.userId,
          entityType: 'FLAG',
          entityId: flag.id,
          version,
          action: 'DELETE',
          before: this.flags.snapshot(flag),
          after: null,
        },
        tx,
      );
    });
  }

  /** One page of a flag's audit history, newest version first. */
  async flagHistory(
    actor: TokenSubject,
    key: string,
    page: HistoryPage,
  ): Promise<AuditPage> {
    const companyId = this.flags.resolveCompany(
      this.auth.tenantScope(actor),
      page.companyId,
    );
    const flag = await this.flags.findByKey(companyId, key);
    return this.audit.history(
      { companyId, entityType: 'FLAG', entityId: flag.id },
      page.limit,
      page.offset,
    );
  }

  /** Restores the flag's state at toVersion as a new version (409 if stale) and audits it as ROLLBACK. */
  async rollbackFlag(
    actor: TokenSubject,
    key: string,
    toVersion: number,
    expectedVersion: number,
  ): Promise<FeatureFlag> {
    const companyId = this.flags.resolveCompany(this.auth.tenantScope(actor));
    const flag = await this.flags.findByKey(companyId, key);
    this.flags.assertCanRollBack(flag, toVersion);
    return this.transactions.run(async (tx) => {
      const old = await this.audit.stateAt(
        { companyId, entityType: 'FLAG', entityId: flag.id },
        toVersion,
        tx,
      );
      const restored = await this.flags.restore(flag, expectedVersion, old, tx);
      await this.audit.record(
        {
          companyId,
          userId: actor.userId,
          entityType: 'FLAG',
          entityId: flag.id,
          version: restored.version,
          action: 'ROLLBACK',
          before: this.flags.snapshot(flag),
          after: this.flags.snapshot(restored),
        },
        tx,
      );
      return restored;
    });
  }

  private createUserWithRoles(
    input: NewUser,
    roleNames: RoleName[],
  ): Promise<UserWithRoles> {
    return this.transactions.run(async (tx) => {
      const user = await this.users.create(input, tx);
      const roles = await this.roles.replaceUserRoles(user, roleNames, tx);
      return Object.assign(user, { roles });
    });
  }
}
