import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CompaniesService } from '../../companies/companies.service.js';
import { TransactionRunner } from '../../database/transaction-runner.js';
import { RolesService } from '../../roles/roles.service.js';
import { UsersService } from '../../users/users.service.js';
import { CompanyFacade } from './company.facade.js';

const ID = '3f2b9c1e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';

describe('CompanyFacade', () => {
  let facade: CompanyFacade;
  // Records the order in which the steps run.
  const calls: string[] = [];
  const companies = {
    remove: vi.fn(() => {
      calls.push('company');
      return Promise.resolve();
    }),
  };
  const users = {
    softDeleteByCompany: vi.fn(() => {
      calls.push('users');
      return Promise.resolve(['u1', 'u2']);
    }),
  };
  const roles = {
    removeAllRolesForUsers: vi.fn(() => {
      calls.push('roles');
      return Promise.resolve();
    }),
  };
  const transactions = {
    run: vi.fn((work: (tx: unknown) => Promise<unknown>) => work('tx')),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    calls.length = 0;
    const moduleRef = await Test.createTestingModule({
      providers: [
        CompanyFacade,
        { provide: CompaniesService, useValue: companies },
        { provide: UsersService, useValue: users },
        { provide: RolesService, useValue: roles },
        { provide: TransactionRunner, useValue: transactions },
      ],
    }).compile();
    facade = moduleRef.get(CompanyFacade);
  });

  it('remove deletes the company, then its users, then their roles, in one transaction', async () => {
    await facade.remove(ID);

    expect(transactions.run).toHaveBeenCalledOnce();
    expect(calls).toEqual(['company', 'users', 'roles']);
    expect(companies.remove).toHaveBeenCalledWith(ID, 'tx');
    expect(users.softDeleteByCompany).toHaveBeenCalledWith(ID, 'tx');
    expect(roles.removeAllRolesForUsers).toHaveBeenCalledWith(
      ['u1', 'u2'],
      'tx',
    );
  });

  it('remove stops at 404 when the company does not exist', async () => {
    companies.remove.mockRejectedValueOnce(new NotFoundException());

    await expect(facade.remove(ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(users.softDeleteByCompany).not.toHaveBeenCalled();
  });
});
