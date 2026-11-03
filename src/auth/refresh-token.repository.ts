import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { BaseRepository } from '../common/base.repository.js';
import { RefreshToken } from './refresh-token.entity.js';

@Injectable()
export class RefreshTokenRepository extends BaseRepository<RefreshToken> {
  constructor(@InjectRepository(RefreshToken) repo: Repository<RefreshToken>) {
    super(repo);
  }

  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.findOneBy({ tokenHash });
  }

  // Only succeeds if the row is still active, so two refreshes with the same token can't both win.
  async markReplaced(
    id: string,
    replacedById: string,
    at: Date,
  ): Promise<boolean> {
    const result = await this.repo.update(
      { id, revokedAt: IsNull(), isDeleted: false },
      { revokedAt: at, replacedById },
    );
    return (result.affected ?? 0) === 1;
  }

  /** Revokes every active token of the user (all sessions); returns how many. */
  async revokeByUser(userId: string, at: Date): Promise<number> {
    const result = await this.repo.update(
      { userId, revokedAt: IsNull(), isDeleted: false },
      { revokedAt: at },
    );
    return result.affected ?? 0;
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    const result = await this.repo.update(
      { familyId, revokedAt: IsNull(), isDeleted: false },
      { revokedAt: at },
    );
    return result.affected ?? 0;
  }
}
