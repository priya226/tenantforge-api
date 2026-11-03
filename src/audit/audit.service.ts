import { Injectable, NotFoundException } from '@nestjs/common';

import type { Transaction } from '../database/transaction-runner.js';
import type {
  AuditAction,
  AuditEntityType,
  AuditEvent,
  Snapshot,
} from './audit-event.entity.js';
import {
  AuditEventRepository,
  type EntityRef,
} from './audit-event.repository.js';

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

export interface AuditPage {
  items: AuditEvent[];
  total: number;
}

export type { EntityRef };

@Injectable()
export class AuditService {
  constructor(private readonly events: AuditEventRepository) {}

  /** Appends one audit row inside the caller's transaction. */
  record(entry: AuditEntry, tx: Transaction): Promise<AuditEvent> {
    const events = this.events.withTransaction(tx);
    return events.save(events.create(entry));
  }

  /** One page of an entity's changes, newest first. */
  async history(
    ref: EntityRef,
    limit: number,
    offset: number,
  ): Promise<AuditPage> {
    const [items, total] = await this.events.findPage(ref, limit, offset);
    return { items, total };
  }

  /** The entity's full state right after `version` was saved; 404 if there is no such version. */
  async stateAt(
    ref: EntityRef,
    version: number,
    tx: Transaction,
  ): Promise<Snapshot> {
    const event = await this.events
      .withTransaction(tx)
      .findByVersion(ref, version);
    if (!event?.after) {
      throw new NotFoundException(`Version ${version} not found`);
    }
    return event.after;
  }
}
