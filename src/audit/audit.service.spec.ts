import { AuditEvent } from './audit-event.entity.js';
import { AuditEventRepository } from './audit-event.repository.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('saves the entry through the transaction-bound repository', async () => {
    const bound = {
      create: vi.fn((data: Partial<AuditEvent>) =>
        Object.assign(new AuditEvent(), data),
      ),
      save: vi.fn((e: AuditEvent) => Promise.resolve(e)),
    };
    const repo = { withTransaction: vi.fn(() => bound) };
    const service = new AuditService(repo as unknown as AuditEventRepository);
    const entry = {
      companyId: 'c1',
      userId: 'u1',
      entityType: 'FLAG' as const,
      entityId: 'f1',
      version: 1,
      action: 'CREATE' as const,
      before: null,
      after: { key: 'new-checkout' },
    };

    const saved = await service.record(entry, 'tx' as never);

    expect(repo.withTransaction).toHaveBeenCalledWith('tx');
    expect(saved).toMatchObject(entry);
  });
});
