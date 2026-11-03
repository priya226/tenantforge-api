import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { AuditEvent } from './audit-event.entity.js';

@Injectable()
export class AuditEventRepository extends BaseRepository<AuditEvent> {
  constructor(@InjectRepository(AuditEvent) repo: Repository<AuditEvent>) {
    super(repo);
  }
}
