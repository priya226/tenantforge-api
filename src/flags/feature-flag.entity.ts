import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../common/base.entity.js';
import type { RolloutType } from './flag-key.js';
import type { FlagRule } from './flag-rule.js';

@Entity('feature_flag')
export class FeatureFlag extends BaseEntity {
  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({
    name: 'rollout_type',
    type: 'varchar',
    length: 10,
    default: 'PERCENT',
  })
  rolloutType!: RolloutType;

  @Column({ name: 'rollout_value', type: 'integer', default: 100 })
  rolloutValue!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  rules!: FlagRule[];

  @Column({ type: 'integer', default: 1 })
  version!: number;
}
