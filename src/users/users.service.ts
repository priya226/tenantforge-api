import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { isEmail } from 'class-validator';
import { In, QueryFailedError } from 'typeorm';

import { CompaniesService } from '../companies/companies.service.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import type { RoleName } from '../roles/role-name.js';
import { RolesService } from '../roles/roles.service.js';
import { normalizeEmail } from './normalize-email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy.js';
import { User } from './user.entity.js';
import { UserRepository } from './user.repository.js';

// What the service needs to create a user. The HTTP DTO (CreateUserDto) implements this,
// so the service doesn't depend on the HTTP layer.
export interface CreateUserInput {
  companyId: string;
  name: string;
  email: string;
  password: string;
  roles?: RoleName[];
}

// A user as returned by the API: the entity (never with the hash) plus its role names.
export type UserWithRoles = User & { roles: RoleName[] };

// Role a new user gets when the request doesn't say: the least privileged one.
const DEFAULT_ROLES: RoleName[] = ['VIEWER'];

// Postgres error code for a unique constraint violation.
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  // A real argon2 hash of a throwaway password, created on first use. See verifyCredentials().
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly companiesService: CompaniesService,
    private readonly rolesService: RolesService,
    private readonly transactions: TransactionRunner,
  ) {}

  async findOne(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async findOneWithRoles(id: string): Promise<UserWithRoles> {
    const user = await this.findOne(id);
    return Object.assign(user, {
      roles: await this.rolesService.getUserRoles(id),
    });
  }

  async create(input: CreateUserInput): Promise<UserWithRoles> {
    // 404 if the company doesn't exist or is soft-deleted.
    await this.companiesService.findOne(input.companyId);

    return this.createWithRoles({
      ...input,
      roles: input.roles ?? DEFAULT_ROLES,
    });
  }

  // Used by `npm run seed:admin`. Creates the first platform admin (no company, PLATFORM_ADMIN role)
  // unless an active platform admin already exists. Safe to run any number of times.
  async ensurePlatformAdmin(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<'created' | 'already-exists'> {
    const adminIds =
      await this.rolesService.getUserIdsWithRole('PLATFORM_ADMIN');
    // count() skips soft-deleted users, so a deleted admin doesn't count.
    if (adminIds.length > 0 && (await this.users.count({ id: In(adminIds) }))) {
      return 'already-exists';
    }

    // The HTTP DTO isn't involved here, so check the same rules by hand.
    if (!isEmail(input.email.trim())) {
      throw new Error(`Not a valid email: "${input.email}"`);
    }
    if (
      input.password.length < PASSWORD_MIN_LENGTH ||
      input.password.length > PASSWORD_MAX_LENGTH
    ) {
      throw new Error(
        `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
      );
    }

    await this.createWithRoles({
      ...input,
      companyId: null,
      roles: ['PLATFORM_ADMIN'],
    });
    return 'created';
  }

  // Shared by create() and ensurePlatformAdmin(): checks, hashes, and saves the user and
  // its roles in one transaction. The caller has already checked the company exists.
  private async createWithRoles(input: {
    companyId: string | null;
    name: string;
    email: string;
    password: string;
    roles: RoleName[];
  }): Promise<UserWithRoles> {
    // Check the roles before the slow argon2 hash, so a bad request fails fast.
    const roleNames = input.roles;
    this.rolesService.assertRolesFitUser(input.companyId, roleNames);

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
    let roles: RoleName[];
    try {
      // The user row and its role rows are saved together: if the role insert fails,
      // the user insert is rolled back too, so there is never a user without roles.
      [saved, roles] = await this.transactions.run(async (tx) => {
        const savedUser = await this.users.withTransaction(tx).save(user);
        const savedRoles = await this.rolesService.replaceUserRoles(
          savedUser,
          roleNames,
          tx,
        );
        return [savedUser, savedRoles] as const;
      });
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
    return Object.assign(saved, { roles });
  }

  // Replaces the user's roles (PUT /users/:id/roles). 404 if the user doesn't exist.
  async setRoles(id: string, roles: RoleName[]): Promise<RoleName[]> {
    const user = await this.findOne(id);
    return this.rolesService.replaceUserRoles(user, roles);
  }

  // GET /users/:id/roles. 404 if the user doesn't exist.
  async getRoles(id: string): Promise<RoleName[]> {
    await this.findOne(id);
    return this.rolesService.getUserRoles(id);
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
