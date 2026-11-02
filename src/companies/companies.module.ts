import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompaniesService } from './companies.service.js';
import { Company } from './company.entity.js';
import { CompanyRepository } from './company.repository.js';

// Feature module: entity + repository + service. No controller (HTTP lives in api/companies).
@Module({
  imports: [TypeOrmModule.forFeature([Company])], // provides the raw Repository<Company> that CompanyRepository wraps
  providers: [CompaniesService, CompanyRepository],
  exports: [CompaniesService], // facades use the service, never the repository
})
export class CompaniesModule {}
