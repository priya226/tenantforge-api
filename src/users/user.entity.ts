import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../common/base.entity.js';

// The table is app_user because "user" is a reserved word in Postgres.
@Entity('app_user')
export class User extends BaseEntity {
  // The company this user belongs to. NULL only for platform admins, who belong to no company.
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  // Always stored lowercased and trimmed (the database enforces this with a CHECK constraint).
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  // select: false means normal queries never load this column, so it can't end up in an API response.
  // Only UserRepository.findForLogin() loads it, explicitly.
  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash?: string;
}
