import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';

import { CompaniesService } from '../companies/companies.service.js';
import { normalizeEmail } from './normalize-email.js';
import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';

// What the service needs to create a user. The HTTP DTO (CreateUserDto) implements this,
// so the service doesn't depend on the HTTP layer.
export interface CreateUserInput {
  companyId: string;
  name: string;
  email: string;
  password: string;
}

// Postgres error code for a unique constraint violation.
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  // A real argon2 hash of a throwaway password, created on first use. See verifyCredentials().
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly companiesService: CompaniesService,
  ) {}

  async findOne(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async create(input: CreateUserInput): Promise<User> {
    // 404 if the company doesn't exist or is soft-deleted.
    await this.companiesService.findOne(input.companyId);

    const email = normalizeEmail(input.email);
    if (await this.users.findByEmail(email)) {
      throw new ConflictException('A user with this email already exists');
    }

    const user = this.users.create({
      companyId: input.companyId,
      name: input.name,
      email,
      passwordHash: await argon2.hash(input.password),
    });

    let saved: User;
    try {
      saved = await this.users.save(user);
    } catch (error) {
      // Two sign-ups with the same email at the same moment can both pass the check above.
      // The unique index then rejects the second one; report it as 409, not 500.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }

    // save() returns the object we built, which still holds the hash. Never let it leave the service.
    delete saved.passwordHash;
    return saved;
  }

  // For login. Returns the user (without the hash) if the email and password match, otherwise null.
  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.users.findForLogin(email);

    // When the email is unknown, still run one argon2 verify against a dummy hash.
    // Otherwise "unknown email" would answer much faster than "wrong password",
    // and an attacker could use the response time to find out which emails have accounts.
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
