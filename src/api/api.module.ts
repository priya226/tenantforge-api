import { Module } from '@nestjs/common';

import { CompaniesModule } from '../companies/companies.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { UsersModule } from '../users/users.module.js';
import { CompaniesController } from './companies/companies.controller.js';
import { FeatureFlagFacade } from './feature-flag.facade.js';
import { RolesController } from './roles/roles.controller.js';
import { UsersController } from './users/users.controller.js';

@Module({
  imports: [CompaniesModule, UsersModule, RolesModule, DatabaseModule],
  controllers: [CompaniesController, UsersController, RolesController],
  providers: [FeatureFlagFacade],
  exports: [FeatureFlagFacade],
})
export class ApiModule {}
