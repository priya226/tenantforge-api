import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { FeatureFlag } from './feature-flag.entity.js';

export type FlagChanges = Partial<
  Pick<
    FeatureFlag,
    | 'description'
    | 'enabled'
    | 'rolloutType'
    | 'rolloutValue'
    | 'rules'
    | 'isDeleted'
  >
>;

@Injectable()
export class FeatureFlagRepository extends BaseRepository<FeatureFlag> {
  constructor(@InjectRepository(FeatureFlag) repo: Repository<FeatureFlag>) {
    super(repo);
  }

  /** Active flags of a company, sorted by key. */
  findByCompany(companyId: string): Promise<FeatureFlag[]> {
    return this.find({ where: { companyId }, order: { key: 'ASC' } });
  }

  /** The active flag with this key in the company, or null. */
  findByKey(companyId: string, key: string): Promise<FeatureFlag | null> {
    return this.findOneBy({ companyId, key });
  }

  /** Applies the changes and bumps the version only if the row is still at expectedVersion; false if not. */
  async updateIfVersion(
    id: string,
    expectedVersion: number,
    changes: FlagChanges,
  ): Promise<boolean> {
    const result = await this.repo.update(
      { id, version: expectedVersion, isDeleted: false },
      { ...changes, version: expectedVersion + 1 } as Parameters<
        Repository<FeatureFlag>['update']
      >[1],
    );
    return (result.affected ?? 0) === 1;
  }
}
