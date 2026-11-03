import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompaniesService } from './companies.service.js';
import { Company } from './company.entity.js';
import { CompanyRepository } from './company.repository.js';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  providers: [CompaniesService, CompanyRepository],
  exports: [CompaniesService],
})
export class CompaniesModule {}
