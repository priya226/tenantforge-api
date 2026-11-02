import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../common/base.entity.js';
import { Role } from './role.entity.js';

// Mapping table: user X holds role Y. A user can hold several roles.
// No company_id here: the company comes from app_user.company_id.
@Entity('user_role')
export class UserRole extends BaseEntity {
  // Plain column, no relation to User: the roles module doesn't need to know about users,
  // which keeps the module graph one-way (users → roles).
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  // Same role_id column, as a relation, so a query can load the role's name in one join.
  // Not loaded unless a query asks for it (relations: { role: true }).
  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role?: Role;
}
