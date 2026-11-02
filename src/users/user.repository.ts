import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { User } from './user.entity.js';

@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(@InjectRepository(User) repo: Repository<User>) {
    super(repo);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.findOneBy({ email });
  }

  // only query that loads passwordHash (select: false on the column)
  findForLogin(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where(this.scopeWhere({ email }, {}))
      .getOne();
  }

  countByIds(ids: string[]): Promise<number> {
    return this.count({ id: In(ids) });
  }

  async findIdsByCompany(companyId: string): Promise<string[]> {
    const users = await this.find({
      where: { companyId },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
