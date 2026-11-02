import { Module } from '@nestjs/common';

import { CompaniesModule } from '../companies/companies.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { UsersModule } from '../users/users.module.js';
import { CompaniesController } from './companies/companies.controller.js';
import { CompanyFacade } from './companies/company.facade.js';

// The HTTP API: controllers + facades. Facades coordinate the feature modules below;
// feature modules never import this module, so dependencies only point downwards.
@Module({
  imports: [CompaniesModule, UsersModule, RolesModule, DatabaseModule],
  controllers: [CompaniesController],
  providers: [CompanyFacade],
})
export class ApiModule {}
