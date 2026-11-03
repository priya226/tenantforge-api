import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { Roles } from '../auth/roles.decorator.js';
import { FeatureFlagFacade } from '../feature-flag.facade.js';
import { Company } from '../../companies/company.entity.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

@Roles('PLATFORM_ADMIN')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly facade: FeatureFlagFacade) {}

  @Post()
  create(@Body() dto: CreateCompanyDto): Promise<Company> {
    return this.facade.createCompany(dto);
  }

  @Get()
  findAll(): Promise<Company[]> {
    return this.facade.findAllCompanies();
  }

  // ParseUUIDPipe returns 400 for a malformed id, before any query runs.
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Company> {
    return this.facade.findCompany(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<Company> {
    return this.facade.updateCompany(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.facade.removeCompany(id);
  }
}
