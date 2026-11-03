import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { FeatureFlag } from '../../flags/feature-flag.entity.js';
import { ROLE_NAMES } from '../../roles/role-name.js';
import {
  CurrentUser,
  type CurrentUserInfo,
} from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { FeatureFlagFacade } from '../feature-flag.facade.js';
import { CreateFlagDto } from './dto/create-flag.dto.js';
import {
  CompanyQuery,
  ExpectedVersionQuery,
  FlagKeyParams,
} from './dto/flag-params.js';
import { UpdateFlagDto } from './dto/update-flag.dto.js';

@Roles('COMPANY_ADMIN')
@Controller('flags')
export class FlagsController {
  constructor(private readonly facade: FeatureFlagFacade) {}

  @Get()
  @Roles(...ROLE_NAMES)
  list(
    @CurrentUser() me: CurrentUserInfo,
    @Query() query: CompanyQuery,
  ): Promise<FeatureFlag[]> {
    return this.facade.listFlags(me, query.companyId);
  }

  @Get(':key')
  @Roles(...ROLE_NAMES)
  findOne(
    @CurrentUser() me: CurrentUserInfo,
    @Param() params: FlagKeyParams,
    @Query() query: CompanyQuery,
  ): Promise<FeatureFlag> {
    return this.facade.findFlag(me, params.key, query.companyId);
  }

  @Post()
  create(
    @CurrentUser() me: CurrentUserInfo,
    @Body() dto: CreateFlagDto,
  ): Promise<FeatureFlag> {
    return this.facade.createFlag(me, dto);
  }

  @Put(':key')
  update(
    @CurrentUser() me: CurrentUserInfo,
    @Param() params: FlagKeyParams,
    @Body() dto: UpdateFlagDto,
  ): Promise<FeatureFlag> {
    const { expectedVersion, ...state } = dto;
    return this.facade.updateFlag(me, params.key, expectedVersion, state);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() me: CurrentUserInfo,
    @Param() params: FlagKeyParams,
    @Query() query: ExpectedVersionQuery,
  ): Promise<void> {
    await this.facade.removeFlag(me, params.key, query.expectedVersion);
  }
}
