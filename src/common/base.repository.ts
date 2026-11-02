import {
  type DeepPartial,
  type EntityManager,
  type FindManyOptions,
  type FindOneOptions,
  type FindOptionsWhere,
  QueryFailedError,
  type Repository,
} from 'typeorm';

import type { BaseEntity } from './base.entity.js';
import { UniqueViolationError } from './unique-violation.error.js';

const UNIQUE_VIOLATION = '23505';

export interface ScopeOptions {
  includeDeleted?: boolean;
}

type Where<T> = FindOptionsWhere<T> | FindOptionsWhere<T>[];

export abstract class BaseRepository<T extends BaseEntity> {
  protected constructor(protected readonly repo: Repository<T>) {}

  withTransaction(tx: EntityManager): this {
    const copy = Object.create(Object.getPrototypeOf(this) as object) as this;
    return Object.assign(copy, this, {
      repo: tx.getRepository<T>(this.repo.target),
    });
  }

  find(
    options: FindManyOptions<T> = {},
    scope: ScopeOptions = {},
  ): Promise<T[]> {
    return this.repo.find({
      ...options,
      where: this.scopeWhere(options.where, scope),
    });
  }

  findOne(
    options: FindOneOptions<T>,
    scope: ScopeOptions = {},
  ): Promise<T | null> {
    return this.repo.findOne({
      ...options,
      where: this.scopeWhere(options.where, scope),
    });
  }

  findOneBy(where: Where<T>, scope: ScopeOptions = {}): Promise<T | null> {
    return this.repo.findOneBy(this.scopeWhere(where, scope));
  }

  count(where?: Where<T>, scope: ScopeOptions = {}): Promise<number> {
    return this.repo.countBy(this.scopeWhere(where, scope));
  }

  create(data: DeepPartial<T>): T {
    return this.repo.create(data);
  }

  save(entity: T): Promise<T> {
    return this.translateErrors(() => this.repo.save(entity));
  }

  async softDelete(entity: T): Promise<void> {
    entity.isDeleted = true;
    await this.save(entity);
  }

  async softDeleteBy(where: FindOptionsWhere<T>): Promise<number> {
    const result = await this.repo.update(
      this.scopeWhere(where, {}) as FindOptionsWhere<T>,
      { isDeleted: true } as unknown as Parameters<Repository<T>['update']>[1],
    );
    return result.affected ?? 0;
  }

  protected async translateErrors<R>(write: () => Promise<R>): Promise<R> {
    try {
      return await write();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new UniqueViolationError({ cause: error });
      }
      throw error;
    }
  }

  protected scopeWhere(
    where: Where<T> | undefined,
    scope: ScopeOptions,
  ): Where<T> {
    if (scope.includeDeleted) {
      return where ?? {};
    }
    const notDeleted = { isDeleted: false } as FindOptionsWhere<T>;
    if (Array.isArray(where)) {
      return where.map((w) => ({ ...w, ...notDeleted }));
    }
    return { ...where, ...notDeleted };
  }
}
