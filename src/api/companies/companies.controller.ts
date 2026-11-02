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

import { CompanyFacade } from './company.facade.js';
import { Company } from '../../companies/company.entity.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

// HTTP only: validates input (DTOs, ParseUUIDPipe) and calls CompanyFacade.
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompanyFacade) {}

  @Post()
  create(@Body() dto: CreateCompanyDto): Promise<Company> {
    return this.companies.create(dto);
  }

  @Get()
  findAll(): Promise<Company[]> {
    return this.companies.findAll();
  }

  // ParseUUIDPipe returns 400 for a malformed id, before any query runs.
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Company> {
    return this.companies.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<Company> {
    return this.companies.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.companies.remove(id);
  }
}
