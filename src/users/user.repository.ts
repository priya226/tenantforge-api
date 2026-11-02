import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { normalizeEmail } from './normalize-email.js';
import { User } from './user.entity.js';

// All database access for users. Reads skip soft-deleted users by default (see BaseRepository).
@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(@InjectRepository(User) repo: Repository<User>) {
    super(repo);
  }

  // For sign-up duplicate checks and profile lookups. Does NOT load passwordHash.
  findByEmail(email: string): Promise<User | null> {
    return this.findOneBy({ email: normalizeEmail(email) });
  }

  // The ONLY query that loads passwordHash, because password_hash is select: false.
  // Use it for login only, and never return its result from a controller.
  findForLogin(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where(this.scopeWhere({ email: normalizeEmail(email) }, {}))
      .getOne();
  }
}
