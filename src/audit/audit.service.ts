import { Injectable } from '@nestjs/common';

import type { Transaction } from '../database/transaction-runner.js';
import type {
  AuditAction,
  AuditEntityType,
  AuditEvent,
  Snapshot,
} from './audit-event.entity.js';
import { AuditEventRepository } from './audit-event.repository.js';

export interface AuditEntry {
  companyId: string;
  userId: string;
  entityType: AuditEntityType;
  entityId: string;
  version: number;
  action: AuditAction;
  before: Snapshot | null;
  after: Snapshot | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly events: AuditEventRepository) {}

  /** Appends one audit row inside the caller's transaction. */
  record(entry: AuditEntry, tx: Transaction): Promise<AuditEvent> {
    const events = this.events.withTransaction(tx);
    return events.save(events.create(entry));
  }
}
