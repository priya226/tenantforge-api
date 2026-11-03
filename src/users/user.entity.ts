import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../common/base.entity.js';

@Entity('app_user')
export class User extends BaseEntity {
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash?: string;
}
