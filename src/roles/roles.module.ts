import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseModule } from '../database/database.module.js';
import { RoleRepository } from './role.repository.js';
import { Role } from './role.entity.js';
import { RolesService } from './roles.service.js';
import { UserRoleRepository } from './user-role.repository.js';
import { UserRole } from './user-role.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Role, UserRole]), DatabaseModule],
  providers: [RolesService, RoleRepository, UserRoleRepository],
  exports: [RolesService],
})
export class RolesModule {}
