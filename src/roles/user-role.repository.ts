import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { UserRole } from './user-role.entity.js';

// All database access for user ↔ role mappings. Soft-deleted mappings are skipped (see BaseRepository).
@Injectable()
export class UserRoleRepository extends BaseRepository<UserRole> {
  constructor(@InjectRepository(UserRole) repo: Repository<UserRole>) {
    super(repo);
  }

  // A user's active mappings, each with its Role loaded (for the name).
  // Also skips mappings whose role row is soft-deleted.
  findByUser(userId: string): Promise<UserRole[]> {
    return this.find({
      where: { userId, role: { isDeleted: false } },
      relations: { role: true },
    });
  }
}
