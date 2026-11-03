import { NotFoundException } from '@nestjs/common';

import { AuditEvent } from './audit-event.entity.js';
import { AuditEventRepository } from './audit-event.repository.js';
import { AuditService } from './audit.service.js';

const REF = { companyId: 'c1', entityType: 'FLAG' as const, entityId: 'f1' };
const TX = 'tx' as never;

describe('AuditService', () => {
  const repo = {
    create: vi.fn((data: Partial<AuditEvent>) =>
      Object.assign(new AuditEvent(), data),
    ),
    save: vi.fn((e: AuditEvent) => Promise.resolve(e)),
    findPage: vi.fn(),
    findByVersion: vi.fn(),
    withTransaction: vi.fn(),
  };
  const service = new AuditService(repo as unknown as AuditEventRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    repo.withTransaction.mockReturnValue(repo);
  });

  it('saves the entry through the transaction-bound repository', async () => {
    const entry = {
      ...REF,
      userId: 'u1',
      version: 1,
      action: 'CREATE' as const,
      before: null,
      after: { key: 'new-checkout' },
    };

    const saved = await service.record(entry, TX);

    expect(repo.withTransaction).toHaveBeenCalledWith(TX);
    expect(saved).toMatchObject(entry);
  });

  it('history returns one page and the total', async () => {
    const rows = [new AuditEvent()];
    repo.findPage.mockResolvedValue([rows, 7]);

    await expect(service.history(REF, 20, 40)).resolves.toEqual({
      items: rows,
      total: 7,
    });
    expect(repo.findPage).toHaveBeenCalledWith(REF, 20, 40);
  });

  describe('stateAt', () => {
    it('returns the after snapshot of that version', async () => {
      repo.findByVersion.mockResolvedValue(
        Object.assign(new AuditEvent(), { after: { enabled: true } }),
      );

      await expect(service.stateAt(REF, 2, TX)).resolves.toEqual({
        enabled: true,
      });
      expect(repo.findByVersion).toHaveBeenCalledWith(REF, 2);
    });

    it('returns 404 for an unknown version or one with no after state', async () => {
      repo.findByVersion.mockResolvedValueOnce(null);
      await expect(service.stateAt(REF, 9, TX)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      repo.findByVersion.mockResolvedValueOnce(
        Object.assign(new AuditEvent(), { action: 'DELETE', after: null }),
      );
      await expect(service.stateAt(REF, 3, TX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
