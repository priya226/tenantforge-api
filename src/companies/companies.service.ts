import { Injectable, NotFoundException } from '@nestjs/common';

import type { Transaction } from '../database/transaction-runner.js';
import { Company } from './company.entity.js';
import { CompanyRepository } from './company.repository.js';

export interface CreateCompanyInput {
  name: string;
  description?: string | null;
}

export interface UpdateCompanyInput {
  name?: string;
  description?: string | null;
}

@Injectable()
export class CompaniesService {
  constructor(private readonly companies: CompanyRepository) {}

  findAll(): Promise<Company[]> {
    return this.companies.findAllNewestFirst();
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

  async lockForUpdate(id: string, tx: Transaction): Promise<Company> {
    const company = await this.companies
      .withTransaction(tx)
      .findByIdForUpdate(id);
    if (!company) {
      throw new NotFoundException(`Company ${id} not found`);
    }
    return company;
  }

  async remove(id: string, tx: Transaction): Promise<void> {
    const companies = this.companies.withTransaction(tx);
    const company = await companies.findOneBy({ id });
    if (!company) {
      throw new NotFoundException(`Company ${id} not found`);
    }
    await companies.softDelete(company);
  }
}
