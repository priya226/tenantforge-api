import {
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Columns shared by every table. Timestamps use timestamptz so they store an exact UTC instant.
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Soft delete flag: queries must filter on isDeleted = false themselves.
  @Column({ name: 'is_deleted', default: false })
  isDeleted!: boolean;
}
