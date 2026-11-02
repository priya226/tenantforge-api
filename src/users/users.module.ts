import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompaniesModule } from '../companies/companies.module.js';
import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]), // provides the raw Repository<User> that UserRepository wraps
    CompaniesModule, // for CompaniesService: a new user's company must exist
  ],
  controllers: [UsersController],
  providers: [UsersService, UserRepository],
  exports: [UsersService], // the auth module will use verifyCredentials()
})
export class UsersModule {}
