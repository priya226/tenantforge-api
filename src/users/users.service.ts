import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { isEmail } from 'class-validator';

import { inScope, type TenantScope } from '../common/tenant-scope.js';
import { UniqueViolationError } from '../common/unique-violation.error.js';
import type { Transaction } from '../database/transaction-runner.js';
import { normalizeEmail } from './normalize-email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy.js';
import { User } from './user.entity.js';
import type { UserSearch } from './user-search.js';
import { UserRepository } from './user.repository.js';

export interface NewUser {
  companyId: string | null;
  name: string;
  email: string;
  password: string;
}

export interface UserPage {
  items: User[];
  total: number;
}

@Injectable()
export class UsersService {
  private dummyHash?: Promise<string>;

  constructor(private readonly users: UserRepository) {}

  async findOne(id: string, scope: TenantScope): Promise<User> {
    const user = await this.users.findOneBy(
      scope.kind === 'all' ? { id } : { id, companyId: scope.companyId },
    );
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  /** One page of users; a company scope only sees its own company, a foreign companyId → 404. */
  async search(scope: TenantScope, input: UserSearch): Promise<UserPage> {
    if (input.companyId !== undefined && !inScope(scope, input.companyId)) {
      throw new NotFoundException(`Company ${input.companyId} not found`);
    }
    const companyId =
      input.companyId ??
      (scope.kind === 'company' ? scope.companyId : undefined);
    const [items, total] = await this.users.search({ ...input, companyId });
    return { items, total };
  }

  /** Trims and validates the name, then renames a user found inside the scope. */
  async rename(id: string, scope: TenantScope, name: string): Promise<User> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new BadRequestException('name must be 1-200 characters');
    }
    const user = await this.findOne(id, scope);
    user.name = trimmed;
    return this.users.save(user);
  }

  findActive(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  async anyActive(ids: string[]): Promise<boolean> {
    if (ids.length === 0) {
      return false;
    }
    return (await this.users.countByIds(ids)) > 0;
  }

  async create(input: NewUser, tx: Transaction): Promise<User> {
    const email = normalizeEmail(input.email);
    if (!isEmail(email)) {
      throw new BadRequestException(`Not a valid email: "${input.email}"`);
    }
    if (
      input.password.length < PASSWORD_MIN_LENGTH ||
      input.password.length > PASSWORD_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
      );
    }

    const users = this.users.withTransaction(tx);
    if (await users.findByEmail(email)) {
      throw new ConflictException('A user with this email already exists');
    }

    const user = users.create({
      companyId: input.companyId,
      name: input.name,
      email,
      passwordHash: await argon2.hash(input.password),
    });

    let saved: User;
    try {
      saved = await users.save(user);
    } catch (error) {
      if (error instanceof UniqueViolationError) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }

    delete saved.passwordHash;
    return saved;
  }

  /** Ids of active users in the company (or all platform users for null), inside tx. */
  findIdsInCompany(
    companyId: string | null,
    tx: Transaction,
  ): Promise<string[]> {
    return this.users.withTransaction(tx).findIdsByCompany(companyId);
  }

  /** 400 when someone tries to delete their own account. */
  assertCanDelete(actorUserId: string, user: User): void {
    if (actorUserId === user.id) {
      throw new BadRequestException("You can't delete your own account");
    }
  }

  /** Soft-deletes one user inside tx. */
  async remove(user: User, tx: Transaction): Promise<void> {
    await this.users.withTransaction(tx).softDelete(user);
  }

  async softDeleteByCompany(
    companyId: string,
    tx: Transaction,
  ): Promise<string[]> {
    const users = this.users.withTransaction(tx);
    const ids = await users.findIdsByCompany(companyId);
    await users.softDeleteBy({ companyId });
    return ids;
  }

  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.users.findForLogin(normalizeEmail(email));

    // unknown email: still verify against a dummy hash so timing doesn't reveal which emails exist
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordMatches = await argon2.verify(hash, password);

    if (!user || !passwordMatches) {
      return null;
    }
    delete user.passwordHash;
    return user;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('dummy-password-for-timing');
    return this.dummyHash;
  }
}
