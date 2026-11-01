import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../common/base.entity.js';

@Entity('company')
export class Company extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
