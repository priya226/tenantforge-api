import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import type { RoleName } from './role-name.js';
import { UserRole } from './user-role.entity.js';

@Injectable()
export class UserRoleRepository extends BaseRepository<UserRole> {
  constructor(@InjectRepository(UserRole) repo: Repository<UserRole>) {
    super(repo);
  }

  findByUser(userId: string): Promise<UserRole[]> {
    return this.find({
      where: { userId, role: { isDeleted: false } },
      relations: { role: true },
    });
  }

  softDeleteByUserIds(userIds: string[]): Promise<number> {
    return this.softDeleteBy({ userId: In(userIds) });
  }

  async findUserIdsWithRole(name: RoleName): Promise<string[]> {
    const mappings = await this.find({
      where: { role: { name, isDeleted: false } },
      relations: { role: true },
    });
    return mappings.map((m) => m.userId);
  }
}
