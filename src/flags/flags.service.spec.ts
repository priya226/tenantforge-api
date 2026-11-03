import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { UniqueViolationError } from '../common/unique-violation.error.js';
import { FeatureFlag } from './feature-flag.entity.js';
import { FeatureFlagRepository } from './feature-flag.repository.js';
import { FlagsService } from './flags.service.js';

const COMPANY_ID = '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const OTHER_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const TX = 'tx' as never;
const COMPANY = { kind: 'company' as const, companyId: COMPANY_ID };
const ALL = { kind: 'all' as const };

const state = {
  description: null,
  enabled: true,
  rolloutType: 'PERCENT' as const,
  rolloutValue: 50,
  rules: [{ attribute: 'region', value: 'IN', percent: 20 }],
};

function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return Object.assign(new FeatureFlag(), {
    id: 'flag-1',
    companyId: COMPANY_ID,
    key: 'new-checkout',
    description: null,
    enabled: false,
    rolloutType: 'PERCENT',
    rolloutValue: 100,
    rules: [],
    version: 1,
    ...overrides,
  });
}

describe('FlagsService', () => {
  const repo = {
    findByCompany: vi.fn(),
    findByKey: vi.fn(),
    findOneBy: vi.fn(),
    updateIfVersion: vi.fn(),
    softDeleteBy: vi.fn(),
    create: vi.fn((data: Partial<FeatureFlag>) =>
      Object.assign(new FeatureFlag(), data),
    ),
    save: vi.fn((f: FeatureFlag) => Promise.resolve(f)),
    withTransaction: vi.fn(),
  };
  const service = new FlagsService(repo as unknown as FeatureFlagRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    repo.withTransaction.mockReturnValue(repo);
  });

  describe('resolveCompany', () => {
    it('uses the caller company when no companyId is given', () => {
      expect(service.resolveCompany(COMPANY)).toBe(COMPANY_ID);
    });

    it('returns 404 for another company', () => {
      expect(() => service.resolveCompany(COMPANY, OTHER_ID)).toThrow(
        NotFoundException,
      );
    });

    it('lets a platform admin pick any company, but requires one', () => {
      expect(service.resolveCompany(ALL, OTHER_ID)).toBe(OTHER_ID);
      expect(() => service.resolveCompany(ALL)).toThrow(BadRequestException);
    });
  });

  it('findByKey returns 404 when the flag is missing', async () => {
    repo.findByKey.mockResolvedValue(null);

    await expect(
      service.findByKey(COMPANY_ID, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('create', () => {
    it('applies defaults and trims rules', async () => {
      const flag = await service.create(
        COMPANY_ID,
        {
          key: 'new-checkout',
          description: '  ',
          rules: [{ attribute: ' region ', value: ' IN ', percent: 20 }],
        },
        TX,
      );

      expect(repo.withTransaction).toHaveBeenCalledWith(TX);
      expect(flag).toMatchObject({
        companyId: COMPANY_ID,
        key: 'new-checkout',
        description: null,
        enabled: false,
        rolloutType: 'PERCENT',
        rolloutValue: 100,
        rules: [{ attribute: 'region', value: 'IN', percent: 20 }],
      });
    });

    it('uses defaults for fields that are present but undefined', async () => {
      const flag = await service.create(
        COMPANY_ID,
        {
          key: 'new-checkout',
          description: undefined,
          enabled: undefined,
          rolloutType: undefined,
          rolloutValue: undefined,
          rules: undefined,
        },
        TX,
      );

      expect(flag).toMatchObject({
        enabled: false,
        rolloutType: 'PERCENT',
        rolloutValue: 100,
        rules: [],
      });
    });

    it('rejects a bad key, a bad percent and duplicate rules with 400', async () => {
      await expect(
        service.create(COMPANY_ID, { key: 'Bad_Key' }, TX),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(COMPANY_ID, { key: 'ok-key', rolloutValue: 101 }, TX),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(
          COMPANY_ID,
          {
            key: 'ok-key',
            rules: [
              { attribute: 'region', value: 'IN', percent: 1 },
              { attribute: 'region', value: 'IN', percent: 2 },
            ],
          },
          TX,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('accepts a COUNT rollout of 1-10000 users', async () => {
      const flag = await service.create(
        COMPANY_ID,
        { key: 'beta-search', rolloutType: 'COUNT', rolloutValue: 10 },
        TX,
      );

      expect(flag).toMatchObject({ rolloutType: 'COUNT', rolloutValue: 10 });
    });

    it('rejects a COUNT of 0 or over 10000, and rules on a COUNT rollout, with 400', async () => {
      const bad = [
        { key: 'beta-search', rolloutType: 'COUNT' as const, rolloutValue: 0 },
        {
          key: 'beta-search',
          rolloutType: 'COUNT' as const,
          rolloutValue: 10_001,
        },
        {
          key: 'beta-search',
          rolloutType: 'COUNT' as const,
          rolloutValue: 10,
          rules: [{ attribute: 'region', value: 'IN', percent: 20 }],
        },
        {
          key: 'beta-search',
          rolloutType: 'FIRST' as never,
          rolloutValue: 10,
        },
      ];
      for (const input of bad) {
        await expect(
          service.create(COMPANY_ID, input, TX),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('returns 409 when the key already exists', async () => {
      repo.save.mockRejectedValueOnce(new UniqueViolationError());

      await expect(
        service.create(COMPANY_ID, { key: 'new-checkout' }, TX),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('updates at the expected version and returns the reloaded row', async () => {
      repo.updateIfVersion.mockResolvedValue(true);
      repo.findOneBy.mockResolvedValue(makeFlag({ version: 2 }));

      const updated = await service.update(makeFlag(), 1, state, TX);

      expect(repo.updateIfVersion).toHaveBeenCalledWith('flag-1', 1, state);
      expect(updated.version).toBe(2);
    });

    it('returns 409 without touching the DB when the read version differs', async () => {
      await expect(
        service.update(makeFlag({ version: 3 }), 2, state, TX),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.updateIfVersion).not.toHaveBeenCalled();
    });

    it('returns 409 when someone saved between the read and the update', async () => {
      repo.updateIfVersion.mockResolvedValue(false);

      await expect(
        service.update(makeFlag(), 1, state, TX),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('remove soft-deletes at the expected version and returns the next version', async () => {
    repo.updateIfVersion.mockResolvedValue(true);

    await expect(service.remove(makeFlag(), 1, TX)).resolves.toBe(2);
    expect(repo.updateIfVersion).toHaveBeenCalledWith('flag-1', 1, {
      isDeleted: true,
    });
  });

  it('snapshot keeps only the flag state and version', () => {
    expect(service.snapshot(makeFlag())).toEqual({
      key: 'new-checkout',
      description: null,
      enabled: false,
      rolloutType: 'PERCENT',
      rolloutValue: 100,
      rules: [],
      version: 1,
    });
  });
});
