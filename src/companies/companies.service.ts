import { Injectable, NotFoundException } from '@nestjs/common';

import type { Transaction } from '../database/transaction-runner.js';
import { Company } from './company.entity.js';
import { CompanyRepository } from './company.repository.js';

// What the service needs. The HTTP DTOs in api/companies implement these,
// so this feature module doesn't depend on the HTTP layer.
export interface CreateCompanyInput {
  name: string;
  description?: string | null;
}

export interface UpdateCompanyInput {
  name?: string;
  description?: string | null;
}

// Business logic for companies only. It never calls other feature services:
// anything that spans features (e.g. deleting a company's users) lives in a facade (api/).
// All database calls go through CompanyRepository, which hides soft-deleted rows.
@Injectable()
export class CompaniesService {
  constructor(private readonly companies: CompanyRepository) {}

  findAll(): Promise<Company[]> {
    return this.companies.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Company> {
    const company = await this.companies.findOneBy({ id });
    if (!company) {
      throw new NotFoundException(`Company ${id} not found`);
    }
    return company;
  }

  create(input: CreateCompanyInput): Promise<Company> {
    const company = this.companies.create({
      name: input.name,
      description: input.description ?? null,
    });
    return this.companies.save(company);
  }

  async update(id: string, input: UpdateCompanyInput): Promise<Company> {
    const company = await this.findOne(id);
    if (input.name !== undefined) {
      company.name = input.name;
    }
    if (input.description !== undefined) {
      company.description = input.description;
    }
    return this.companies.save(company);
  }

  // Soft-deletes the company row only, inside the caller's transaction.
  // CompanyFacade.remove() also deletes everything the company owns.
  async remove(id: string, tx: Transaction): Promise<void> {
    const companies = this.companies.withTransaction(tx);
    const company = await companies.findOneBy({ id });
    if (!company) {
      throw new NotFoundException(`Company ${id} not found`);
    }
    await companies.softDelete(company);
  }
}
