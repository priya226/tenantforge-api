import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../common/base.entity.js';
import type { RoleName } from './role-name.js';

// A role a user can hold. Rows are inserted by the V3 migration; there is no API to create them.
@Entity('role')
export class Role extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  name!: RoleName;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
