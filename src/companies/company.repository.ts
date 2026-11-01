import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { Company } from './company.entity.js';

// All database access for companies. Reads skip soft-deleted rows by default (see BaseRepository).
@Injectable()
export class CompanyRepository extends BaseRepository<Company> {
  constructor(@InjectRepository(Company) repo: Repository<Company>) {
    super(repo);
  }
}
