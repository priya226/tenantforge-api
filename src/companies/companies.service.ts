import { Injectable, NotFoundException } from '@nestjs/common';

import { Company } from './company.entity.js';
import { CompanyRepository } from './company.repository.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

// Business logic for companies. All database calls go through CompanyRepository,
// which already hides soft-deleted rows, so this class never filters on isDeleted.
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

  create(dto: CreateCompanyDto): Promise<Company> {
    const company = this.companies.create({
      name: dto.name,
      description: dto.description ?? null,
    });
    return this.companies.save(company);
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    const company = await this.findOne(id);
    if (dto.name !== undefined) {
      company.name = dto.name;
    }
    if (dto.description !== undefined) {
      company.description = dto.description;
    }
    return this.companies.save(company);
  }

  async remove(id: string): Promise<void> {
    const company = await this.findOne(id);
    await this.companies.softDelete(company);
  }
}
