import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { AuditEvent, type AuditEntityType } from './audit-event.entity.js';

export interface EntityRef {
  companyId: string;
  entityType: AuditEntityType;
  entityId: string;
}

@Injectable()
export class AuditEventRepository extends BaseRepository<AuditEvent> {
  constructor(@InjectRepository(AuditEvent) repo: Repository<AuditEvent>) {
    super(repo);
  }

  /** One page of an entity's audit rows, newest version first, plus the total. */
  findPage(
    ref: EntityRef,
    limit: number,
    offset: number,
  ): Promise<[AuditEvent[], number]> {
    return this.findAndCount({
      where: { ...ref },
      order: { version: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /** The audit row that produced this version of the entity, or null. */
  findByVersion(ref: EntityRef, version: number): Promise<AuditEvent | null> {
    return this.findOneBy({ ...ref, version });
  }
}
