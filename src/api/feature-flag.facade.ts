import { Injectable } from '@nestjs/common';

import {
  type CreateCompanyInput,
  CompaniesService,
  type UpdateCompanyInput,
} from '../companies/companies.service.js';
import { Company } from '../companies/company.entity.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import type { RoleName } from '../roles/role-name.js';
import { RolesService } from '../roles/roles.service.js';
import { User } from '../users/user.entity.js';
import { type NewUser, UsersService } from '../users/users.service.js';

export interface CreateUserRequest {
  companyId: string;
  name: string;
  email: string;
  password: string;
  roles?: RoleName[];
}

export type UserWithRoles = User & { roles: RoleName[] };

@Injectable()
export class FeatureFlagFacade {
  constructor(
    private readonly companies: CompaniesService,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly transactions: TransactionRunner,
  ) {}

  findAllCompanies(): Promise<Company[]> {
    return this.companies.findAll();
  }

  findCompany(id: string): Promise<Company> {
    return this.companies.findOne(id);
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
    });
  }

  async createUser(input: CreateUserRequest): Promise<UserWithRoles> {
    await this.companies.findOne(input.companyId);
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

  async findUser(id: string): Promise<UserWithRoles> {
    const user = await this.users.findOne(id);
    return Object.assign(user, { roles: await this.roles.getUserRoles(id) });
  }

  async getUserRoles(id: string): Promise<RoleName[]> {
    await this.users.findOne(id);
    return this.roles.getUserRoles(id);
  }

  async setUserRoles(id: string, roles: RoleName[]): Promise<RoleName[]> {
    const user = await this.users.findOne(id);
    return this.roles.replaceUserRoles(user, roles);
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
