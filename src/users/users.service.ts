import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { isEmail } from 'class-validator';

import { UniqueViolationError } from '../common/unique-violation.error.js';
import type { Transaction } from '../database/transaction-runner.js';
import { normalizeEmail } from './normalize-email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy.js';
import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';

export interface NewUser {
  companyId: string | null;
  name: string;
  email: string;
  password: string;
}

@Injectable()
export class UsersService {
  private dummyHash?: Promise<string>;

  constructor(private readonly users: UserRepository) {}

  async findOne(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
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
