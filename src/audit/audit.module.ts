import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEvent } from './audit-event.entity.js';
import { AuditEventRepository } from './audit-event.repository.js';
import { AuditService } from './audit.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService, AuditEventRepository],
  exports: [AuditService],
})
export class AuditModule {}
