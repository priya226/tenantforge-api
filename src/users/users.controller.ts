import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';

import type { RoleName } from '../roles/role-name.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto.js';
import { type UserWithRoles, UsersService } from './users.service.js';

// No authentication yet. Once auth exists, only admins will be able to create users
// and change roles, and only inside their own company.
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserWithRoles> {
    return this.usersService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserWithRoles> {
    return this.usersService.findOneWithRoles(id);
  }

  @Get(':id/roles')
  async getRoles(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ roles: RoleName[] }> {
    return { roles: await this.usersService.getRoles(id) };
  }

  // Replaces the whole set: { "roles": ["COMPANY_ADMIN"] } leaves the user with exactly that role.
  @Put(':id/roles')
  async setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRolesDto,
  ): Promise<{ roles: RoleName[] }> {
    return { roles: await this.usersService.setRoles(id, dto.roles) };
  }
}
