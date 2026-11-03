import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { inScope, type TenantScope } from '../common/tenant-scope.js';
import { UniqueViolationError } from '../common/unique-violation.error.js';
import type { Transaction } from '../database/transaction-runner.js';
import { FeatureFlag } from './feature-flag.entity.js';
import { FeatureFlagRepository } from './feature-flag.repository.js';
import {
  FLAG_KEY_PATTERN,
  MAX_ROLLOUT_COUNT,
  MAX_RULES,
  type RolloutType,
} from './flag-key.js';
import type { FlagRule } from './flag-rule.js';

export type FlagState = {
  description: string | null;
  enabled: boolean;
  rolloutType: RolloutType;
  rolloutValue: number;
  rules: FlagRule[];
};

export type CreateFlagInput = { key: string } & Partial<FlagState>;

export type FlagSnapshot = FlagState & { key: string; version: number };

const NEW_FLAG: FlagState = {
  description: null,
  enabled: false,
  rolloutType: 'PERCENT',
  rolloutValue: 100,
  rules: [],
};

@Injectable()
export class FlagsService {
  constructor(private readonly flags: FeatureFlagRepository) {}

  /** The company whose flags the caller works on: own company, or ?companyId for a platform admin. */
  resolveCompany(scope: TenantScope, companyId?: string): string {
    if (companyId !== undefined && !inScope(scope, companyId)) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }
    const resolved =
      companyId ?? (scope.kind === 'company' ? scope.companyId : undefined);
    if (!resolved) {
      throw new BadRequestException('companyId is required');
    }
    return resolved;
  }

  /** Active flags of the company, sorted by key. */
  list(companyId: string): Promise<FeatureFlag[]> {
    return this.flags.findByCompany(companyId);
  }

  /** The active flag with this key, or 404. */
  async findByKey(companyId: string, key: string): Promise<FeatureFlag> {
    const flag = await this.flags.findByKey(companyId, key);
    if (!flag) {
      throw new NotFoundException(`Flag ${key} not found`);
    }
    return flag;
  }

  /** Validates and saves a new flag at version 1; 409 if the key is taken. */
  async create(
    companyId: string,
    input: CreateFlagInput,
    tx: Transaction,
  ): Promise<FeatureFlag> {
    if (!FLAG_KEY_PATTERN.test(input.key)) {
      throw new BadRequestException(
        'key must be 2-64 characters: lowercase letters, digits and dashes, starting with a letter',
      );
    }
    const state = this.validState({
      description: input.description ?? NEW_FLAG.description,
      enabled: input.enabled ?? NEW_FLAG.enabled,
      rolloutType: input.rolloutType ?? NEW_FLAG.rolloutType,
      rolloutValue: input.rolloutValue ?? NEW_FLAG.rolloutValue,
      rules: input.rules ?? NEW_FLAG.rules,
    });
    const flags = this.flags.withTransaction(tx);
    try {
      return await flags.save(
        flags.create({ companyId, key: input.key, ...state }),
      );
    } catch (error) {
      if (error instanceof UniqueViolationError) {
        throw new ConflictException(`Flag ${input.key} already exists`);
      }
      throw error;
    }
  }

  /** Replaces the flag's state if it is still at expectedVersion (409 otherwise); returns the new row. */
  async update(
    flag: FeatureFlag,
    expectedVersion: number,
    input: FlagState,
    tx: Transaction,
  ): Promise<FeatureFlag> {
    const state = this.validState(input);
    const flags = this.flags.withTransaction(tx);
    await this.changeIfVersion(flags, flag, expectedVersion, state);
    return (await flags.findOneBy({ id: flag.id }))!;
  }

  /** Soft-deletes the flag if it is still at expectedVersion (409 otherwise); returns the new version. */
  async remove(
    flag: FeatureFlag,
    expectedVersion: number,
    tx: Transaction,
  ): Promise<number> {
    await this.changeIfVersion(
      this.flags.withTransaction(tx),
      flag,
      expectedVersion,
      { isDeleted: true },
    );
    return expectedVersion + 1;
  }

  /** Soft-deletes every flag of the company (company cascade). */
  async softDeleteByCompany(companyId: string, tx: Transaction): Promise<void> {
    await this.flags.withTransaction(tx).softDeleteBy({ companyId });
  }

  /** The flag's state as stored in an audit snapshot. */
  snapshot(flag: FeatureFlag): FlagSnapshot {
    return {
      key: flag.key,
      description: flag.description,
      enabled: flag.enabled,
      rolloutType: flag.rolloutType,
      rolloutValue: flag.rolloutValue,
      rules: flag.rules,
      version: flag.version,
    };
  }

  private async changeIfVersion(
    flags: FeatureFlagRepository,
    flag: FeatureFlag,
    expectedVersion: number,
    changes: Parameters<FeatureFlagRepository['updateIfVersion']>[2],
  ): Promise<void> {
    const changed =
      flag.version === expectedVersion &&
      (await flags.updateIfVersion(flag.id, expectedVersion, changes));
    if (!changed) {
      throw new ConflictException(
        `Flag ${flag.key} was changed by someone else (expected version ${expectedVersion}). Reload and try again.`,
      );
    }
  }

  private validState(input: FlagState): FlagState {
    const description = input.description?.trim() || null;
    this.assertValidRollout(input);
    if (input.rules.length > MAX_RULES) {
      throw new BadRequestException(
        `A flag can have at most ${MAX_RULES} rules`,
      );
    }
    const seen = new Set<string>();
    const rules = input.rules.map((rule) => {
      const attribute = rule.attribute.trim();
      const value = rule.value.trim();
      if (!attribute || !value || !isPercent(rule.percent)) {
        throw new BadRequestException(
          'Each rule needs an attribute, a value and a percent 0-100',
        );
      }
      const id = `${attribute}\u0000${value}`;
      if (seen.has(id)) {
        throw new BadRequestException(
          `Duplicate rule for ${attribute} = ${value}`,
        );
      }
      seen.add(id);
      return { attribute, value, percent: rule.percent };
    });
    return {
      description,
      enabled: input.enabled,
      rolloutType: input.rolloutType,
      rolloutValue: input.rolloutValue,
      rules,
    };
  }

  private assertValidRollout(input: FlagState): void {
    const { rolloutType, rolloutValue, rules } = input;
    if (rolloutType === 'PERCENT') {
      if (!isPercent(rolloutValue)) {
        throw new BadRequestException(
          'rolloutValue must be 0-100 for a PERCENT rollout',
        );
      }
      return;
    }
    if (rolloutType !== 'COUNT') {
      throw new BadRequestException('rolloutType must be PERCENT or COUNT');
    }
    if (
      !Number.isInteger(rolloutValue) ||
      rolloutValue < 1 ||
      rolloutValue > MAX_ROLLOUT_COUNT
    ) {
      throw new BadRequestException(
        `rolloutValue must be 1-${MAX_ROLLOUT_COUNT} for a COUNT rollout`,
      );
    }
    if (rules.length > 0) {
      throw new BadRequestException(
        'Rules can only be used with a PERCENT rollout',
      );
    }
  }
}

function isPercent(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 100;
}
