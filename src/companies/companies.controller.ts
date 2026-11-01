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

import { CompaniesService } from './companies.service.js';
import { Company } from './company.entity.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() dto: CreateCompanyDto): Promise<Company> {
    return this.companiesService.create(dto);
  }

  @Get()
  findAll(): Promise<Company[]> {
    return this.companiesService.findAll();
  }

  // ParseUUIDPipe returns 400 for a malformed id, before any query runs.
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Company> {
    return this.companiesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<Company> {
    return this.companiesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.companiesService.remove(id);
  }
}
