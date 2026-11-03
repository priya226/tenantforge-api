import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth/auth.controller.js';
import { CompaniesController } from './companies/companies.controller.js';
import { FeatureFlagFacade } from './feature-flag.facade.js';
import { RolesController } from './roles/roles.controller.js';
import { UsersController } from './users/users.controller.js';

@Module({
  imports: [
    CompaniesModule,
    UsersModule,
    RolesModule,
    AuthModule,
    DatabaseModule,
  ],
  controllers: [
    AuthController,
    CompaniesController,
    UsersController,
    RolesController,
  ],
  providers: [FeatureFlagFacade],
  exports: [FeatureFlagFacade],
})
export class ApiModule {}
