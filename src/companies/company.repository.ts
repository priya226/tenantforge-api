import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { Company } from './company.entity.js';

@Injectable()
export class CompanyRepository extends BaseRepository<Company> {
  constructor(@InjectRepository(Company) repo: Repository<Company>) {
    super(repo);
  }

  findAllNewestFirst(): Promise<Company[]> {
    return this.find({ order: { createdAt: 'DESC' } });
  }
}
