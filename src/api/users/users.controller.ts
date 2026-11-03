import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';

import type { RoleName } from '../../roles/role-name.js';
import { Roles } from '../auth/roles.decorator.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto.js';
import {
  FeatureFlagFacade,
  type UserWithRoles,
} from '../feature-flag.facade.js';

@Roles('COMPANY_ADMIN', 'PLATFORM_ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly facade: FeatureFlagFacade) {}

  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserWithRoles> {
    return this.facade.createUser(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserWithRoles> {
    return this.facade.findUser(id);
  }

  @Get(':id/roles')
  async getRoles(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ roles: RoleName[] }> {
    return { roles: await this.facade.getUserRoles(id) };
  }

  @Put(':id/roles')
  async setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRolesDto,
  ): Promise<{ roles: RoleName[] }> {
    return { roles: await this.facade.setUserRoles(id, dto.roles) };
  }
}
