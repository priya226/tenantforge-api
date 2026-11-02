import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import type { RoleName } from './role-name.js';
import { Role } from './role.entity.js';

// All database access for the role lookup table. Soft-deleted roles are skipped (see BaseRepository).
@Injectable()
export class RoleRepository extends BaseRepository<Role> {
  constructor(@InjectRepository(Role) repo: Repository<Role>) {
    super(repo);
  }

  // Turns role names into Role rows (to get their ids). Duplicates in `names` are fine.
  findByNames(names: readonly RoleName[]): Promise<Role[]> {
    return this.find({ where: { name: In([...new Set(names)]) } });
  }
}
