import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { Company } from './company.entity.js';
import { CompanyRepository } from './company.repository.js';

@Module({
  imports: [TypeOrmModule.forFeature([Company])], // provides the raw Repository<Company> that CompanyRepository wraps
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyRepository],
  exports: [CompaniesService], // other modules use the service, never the repository
})
export class CompaniesModule {}
