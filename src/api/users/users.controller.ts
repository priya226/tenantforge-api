import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ROLE_NAMES, type RoleName } from '../../roles/role-name.js';
import {
  CurrentUser,
  type CurrentUserInfo,
} from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQuery } from './dto/list-users.query.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto.js';
import {
  FeatureFlagFacade,
  type UserListPage,
  type UserWithRoles,
} from '../feature-flag.facade.js';

@Roles('COMPANY_ADMIN', 'PLATFORM_ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly facade: FeatureFlagFacade) {}

  @Post()
  create(
    @CurrentUser() me: CurrentUserInfo,
    @Body() dto: CreateUserDto,
  ): Promise<UserWithRoles> {
    return this.facade.createUser(me, dto);
  }

  @Get()
  list(
    @CurrentUser() me: CurrentUserInfo,
    @Query() query: ListUsersQuery,
  ): Promise<UserListPage> {
    return this.facade.listUsers(me, query);
  }

  @Get('me')
  @Roles(...ROLE_NAMES)
  findMe(@CurrentUser() me: CurrentUserInfo): Promise<UserWithRoles> {
    return this.facade.findUser(me, me.userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() me: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserWithRoles> {
    return this.facade.findUser(me, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() me: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserWithRoles> {
    return this.facade.renameUser(me, id, dto.name);
  }

  @Get(':id/roles')
  async getRoles(
    @CurrentUser() me: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ roles: RoleName[] }> {
    return { roles: await this.facade.getUserRoles(me, id) };
  }

  @Put(':id/roles')
  async setRoles(
    @CurrentUser() me: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRolesDto,
  ): Promise<{ roles: RoleName[] }> {
    return { roles: await this.facade.setUserRoles(me, id, dto.roles) };
  }
}
