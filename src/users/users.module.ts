import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompaniesModule } from '../companies/companies.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]), // provides the raw Repository<User> that UserRepository wraps
    CompaniesModule, // for CompaniesService: a new user's company must exist
    RolesModule, // for RolesService: roles on create, GET/PUT /users/:id/roles
    DatabaseModule, // for TransactionRunner: user + roles saved in one transaction
  ],
  controllers: [UsersController],
  providers: [UsersService, UserRepository],
  exports: [UsersService], // the auth module will use verifyCredentials()
})
export class UsersModule {}
