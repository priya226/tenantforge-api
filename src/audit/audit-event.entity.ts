import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../common/base.entity.js';

export type AuditEntityType = 'FLAG' | 'SETTING';
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'ROLLBACK';
export type Snapshot = Record<string, unknown>;

@Entity('audit_event')
export class AuditEvent extends BaseEntity {
  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 20 })
  entityType!: AuditEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', length: 20 })
  action!: AuditAction;

  @Column({ name: 'before_json', type: 'jsonb', nullable: true })
  before!: Snapshot | null;

  @Column({ name: 'after_json', type: 'jsonb', nullable: true })
  after!: Snapshot | null;
}
