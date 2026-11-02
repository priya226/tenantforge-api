import { Injectable } from '@nestjs/common';

import {
  type CreateCompanyInput,
  CompaniesService,
  type UpdateCompanyInput,
} from '../../companies/companies.service.js';
import { Company } from '../../companies/company.entity.js';
import { TransactionRunner } from '../../database/transaction-runner.js';
import { RolesService } from '../../roles/roles.service.js';
import { UsersService } from '../../users/users.service.js';

// Use cases for companies. Simple ones pass straight through to CompaniesService;
// remove() coordinates several features in one transaction.
@Injectable()
export class CompanyFacade {
  constructor(
    private readonly companies: CompaniesService,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly transactions: TransactionRunner,
  ) {}

  findAll(): Promise<Company[]> {
    return this.companies.findAll();
  }

  findOne(id: string): Promise<Company> {
    return this.companies.findOne(id);
  }

  create(input: CreateCompanyInput): Promise<Company> {
    return this.companies.create(input);
  }

  update(id: string, input: UpdateCompanyInput): Promise<Company> {
    return this.companies.update(id, input);
  }

  // Deleting a company soft-deletes everything that belongs to it, all or nothing.
  // When a new feature owns company data (flags, API keys, settings), add its step here.
  async remove(id: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      await this.companies.remove(id, tx); // 404 if missing; nothing else runs
      const userIds = await this.users.softDeleteByCompany(id, tx);
      await this.roles.removeAllRolesForUsers(userIds, tx);
    });
  }
}
