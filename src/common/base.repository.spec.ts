import { type EntityManager, QueryFailedError, type Repository } from 'typeorm';

import { BaseEntity } from './base.entity.js';
import { BaseRepository } from './base.repository.js';
import { UniqueViolationError } from './unique-violation.error.js';

class Thing extends BaseEntity {
  name!: string;
}

class ThingRepository extends BaseRepository<Thing> {
  constructor(repo: Repository<Thing>) {
    super(repo);
  }
}

describe('BaseRepository', () => {
  const raw = {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    findOneBy: vi.fn().mockResolvedValue(null),
    countBy: vi.fn().mockResolvedValue(0),
    save: vi.fn((t: Thing) => Promise.resolve(t)),
  };
  const repo = new ThingRepository(raw as unknown as Repository<Thing>);

  beforeEach(() => vi.clearAllMocks());

  it('find with no where clause only returns rows that are not deleted', async () => {
    await repo.find();
    expect(raw.find).toHaveBeenCalledWith({ where: { isDeleted: false } });
  });

  it('find keeps the caller where clause and other options', async () => {
    await repo.find({ where: { name: 'a' }, order: { createdAt: 'DESC' } });
    expect(raw.find).toHaveBeenCalledWith({
      where: { name: 'a', isDeleted: false },
      order: { createdAt: 'DESC' },
    });
  });

  it('adds the filter to every branch of an OR (array) where clause', async () => {
    await repo.find({ where: [{ name: 'a' }, { name: 'b' }] });
    expect(raw.find).toHaveBeenCalledWith({
      where: [
        { name: 'a', isDeleted: false },
        { name: 'b', isDeleted: false },
      ],
    });
  });

  it('a caller cannot override the filter by passing isDeleted: true', async () => {
    await repo.findOneBy({ id: '1', isDeleted: true });
    expect(raw.findOneBy).toHaveBeenCalledWith({ id: '1', isDeleted: false });
  });

  it('includeDeleted: true returns deleted rows too', async () => {
    await repo.findOneBy({ id: '1' }, { includeDeleted: true });
    expect(raw.findOneBy).toHaveBeenCalledWith({ id: '1' });
  });

  it('findOne and count are filtered as well', async () => {
    await repo.findOne({ where: { id: '1' } });
    await repo.count();
    expect(raw.findOne).toHaveBeenCalledWith({
      where: { id: '1', isDeleted: false },
    });
    expect(raw.countBy).toHaveBeenCalledWith({ isDeleted: false });
  });

  it('softDelete marks the row deleted and saves it, without removing it', async () => {
    const thing = Object.assign(new Thing(), { id: '1', isDeleted: false });
    await repo.softDelete(thing);
    expect(raw.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', isDeleted: true }),
    );
  });

  it('save turns a Postgres unique violation (23505) into UniqueViolationError', async () => {
    raw.save.mockRejectedValueOnce(
      new QueryFailedError('INSERT ...', [], { code: '23505' } as never),
    );
    await expect(repo.save(new Thing())).rejects.toBeInstanceOf(
      UniqueViolationError,
    );
  });

  it('save rethrows other database errors unchanged', async () => {
    const error = new QueryFailedError('INSERT ...', [], {
      code: '23503',
    } as never);
    raw.save.mockRejectedValueOnce(error);
    await expect(repo.save(new Thing())).rejects.toBe(error);
  });

  it('withTransaction returns a copy that queries through the transaction and still filters deleted rows', async () => {
    const txRaw = { find: vi.fn().mockResolvedValue([]) };
    const tx = {
      getRepository: vi.fn(() => txRaw),
    } as unknown as EntityManager;

    const inTx = repo.withTransaction(tx);
    await inTx.find();

    expect(inTx).toBeInstanceOf(ThingRepository);
    expect(txRaw.find).toHaveBeenCalledWith({ where: { isDeleted: false } });
    expect(raw.find).not.toHaveBeenCalled();
  });
});
