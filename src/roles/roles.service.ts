import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import {
  type Transaction,
  TransactionRunner,
} from '../database/transaction-runner.js';
import type { RoleName } from './role-name.js';
import { RoleRepository } from './role.repository.js';
import { UserRoleRepository } from './user-role.repository.js';

// The parts of a user the roles logic needs. Defined here (not imported from users/)
// so the roles module doesn't depend on the users module.
export interface RoleHolder {
  id: string;
  companyId: string | null;
}

// Postgres error code for a unique constraint violation.
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly transactions: TransactionRunner,
  ) {}

  // The names of the roles a user currently holds, sorted.
  async getUserRoles(userId: string): Promise<RoleName[]> {
    const mappings = await this.userRoles.findByUser(userId);
    return mappings.map((m) => m.role!.name).sort();
  }

  // Throws 400 unless the roles fit the user's company:
  // a user without a company may only be PLATFORM_ADMIN,
  // a user with a company may hold any role except PLATFORM_ADMIN.
  assertRolesFitUser(companyId: string | null, names: RoleName[]): void {
    if (names.length === 0) {
      throw new BadRequestException('A user must have at least one role');
    }
    const isPlatformUser = companyId === null;
    for (const name of names) {
      if (isPlatformUser && name !== 'PLATFORM_ADMIN') {
        throw new BadRequestException(
          `${name} requires a company; a user without a company can only be PLATFORM_ADMIN`,
        );
      }
      if (!isPlatformUser && name === 'PLATFORM_ADMIN') {
        throw new BadRequestException(
          'PLATFORM_ADMIN is only for users without a company',
        );
      }
    }
  }

  // Makes the user's roles exactly `names`: removed roles are soft-deleted, new ones are added,
  // roles the user keeps are left untouched. Returns the final role names, sorted.
  //
  // Pass `tx` to join a transaction the caller already started (e.g. "create user + roles").
  // Without it, this method runs in its own transaction.
  async replaceUserRoles(
    user: RoleHolder,
    names: RoleName[],
    tx?: Transaction,
  ): Promise<RoleName[]> {
    this.assertRolesFitUser(user.companyId, names);
    const wanted = [...new Set(names)];

    const work = async (t: Transaction): Promise<RoleName[]> => {
      const roles = this.roles.withTransaction(t);
      const userRoles = this.userRoles.withTransaction(t);

      const wantedRoles = await roles.findByNames(wanted);
      if (wantedRoles.length !== wanted.length) {
        // ROLE_NAMES in code and the rows from V3 have drifted apart. A bug, not a client error.
        throw new Error(
          `Role rows missing in the database for: ${wanted.join(', ')}`,
        );
      }
      const wantedIds = new Set(wantedRoles.map((r) => r.id));

      const current = await userRoles.findByUser(user.id);
      const currentIds = new Set(current.map((m) => m.roleId));

      for (const mapping of current) {
        if (!wantedIds.has(mapping.roleId)) {
          await userRoles.softDelete(mapping);
        }
      }
      for (const role of wantedRoles) {
        if (!currentIds.has(role.id)) {
          await userRoles.save(
            userRoles.create({ userId: user.id, roleId: role.id }),
          );
        }
      }
      return wanted.sort();
    };

    try {
      return await (tx ? work(tx) : this.transactions.run(work));
    } catch (error) {
      // Two requests changing the same user's roles at once can both try to add the same role.
      // The unique index rejects the second one; report it as 409, not 500.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          "This user's roles were changed at the same time. Please try again.",
        );
      }
      throw error;
    }
  }
}
