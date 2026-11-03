import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FlagsModule } from '../flags/flags.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth/auth.controller.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { CompaniesController } from './companies/companies.controller.js';
import { FeatureFlagFacade } from './feature-flag.facade.js';
import { FlagsController } from './flags/flags.controller.js';
import { RolesController } from './roles/roles.controller.js';
import { UsersController } from './users/users.controller.js';

@Module({
  imports: [
    CompaniesModule,
    UsersModule,
    RolesModule,
    AuthModule,
    FlagsModule,
    AuditModule,
    DatabaseModule,
  ],
  controllers: [
    AuthController,
    CompaniesController,
    UsersController,
    RolesController,
    FlagsController,
  ],
  providers: [
    FeatureFlagFacade,
    //App_Gaurd to make it global gaurd , orders matter here, first jwt gaurd then roles gaurd
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [FeatureFlagFacade],
})
export class ApiModule {}
