import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CompaniesService } from './companies.service.js';
import { Company } from './company.entity.js';
import { CompanyRepository } from './company.repository.js';

const ID = '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return Object.assign(new Company(), {
    id: ID,
    name: 'Acme',
    description: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

describe('CompaniesService', () => {
  let service: CompaniesService;
  // A fake CompanyRepository. The isDeleted filtering itself is tested in base.repository.spec.ts.
  const repo = {
    find: vi.fn(),
    findOneBy: vi.fn(),
    create: vi.fn((data: Partial<Company>) =>
      Object.assign(new Company(), data),
    ),
    save: vi.fn((company: Company) => Promise.resolve(company)),
    softDelete: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: CompanyRepository, useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(CompaniesService);
  });

  it('findAll lists companies newest first', async () => {
    repo.find.mockResolvedValue([makeCompany()]);

    await service.findAll();

    expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
  });

  it('findOne throws NotFoundException when the repository finds nothing', async () => {
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.findOne(ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOneBy).toHaveBeenCalledWith({ id: ID });
  });

  it('create stores a missing description as null', async () => {
    const created = await service.create({ name: 'Acme' });

    expect(created.description).toBeNull();
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it('update changes only the fields that were sent', async () => {
    repo.findOneBy.mockResolvedValue(makeCompany({ description: 'old' }));

    const updated = await service.update(ID, { name: 'Acme Inc' });

    expect(updated.name).toBe('Acme Inc');
    expect(updated.description).toBe('old');
  });

  it('remove soft-deletes the company through the repository', async () => {
    const company = makeCompany();
    repo.findOneBy.mockResolvedValue(company);

    await service.remove(ID);

    expect(repo.softDelete).toHaveBeenCalledWith(company);
  });

  it('remove throws NotFoundException for a missing company', async () => {
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.remove(ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });
});
