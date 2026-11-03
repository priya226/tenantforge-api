import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type FindOptionsWhere, ILike, In, Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import type { UserSearch } from './user-search.js';
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

  /** Page of users matching q in email or name (case-insensitive), newest first, with the total count. */
  search(input: UserSearch): Promise<[User[], number]> {
    const base: FindOptionsWhere<User> =
      input.companyId === undefined ? {} : { companyId: input.companyId };
    const where = input.q
      ? [
          { ...base, email: ILike(`%${escapeLike(input.q)}%`) },
          { ...base, name: ILike(`%${escapeLike(input.q)}%`) },
        ]
      : base;
    return this.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      take: input.limit,
      skip: input.offset,
    });
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

// so a search for "50%" or "a_b" matches those characters literally
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c);
}
