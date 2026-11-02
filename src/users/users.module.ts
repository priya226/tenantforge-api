import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService, UserRepository],
  exports: [UsersService],
})
export class UsersModule {}
