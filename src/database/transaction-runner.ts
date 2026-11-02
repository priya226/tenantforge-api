import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

// A running transaction. Pass it to repository.withTransaction(tx) so that repository's
// queries run inside it. It's TypeORM's EntityManager, but services only pass it along.
export type Transaction = EntityManager;

// Runs a block of work in one database transaction: if the block finishes, everything is
// committed; if it throws, everything is rolled back and the error is rethrown.
//
// Usage in a service:
//   await this.transactions.run(async (tx) => {
//     const user = await this.users.withTransaction(tx).save(...);
//     await this.userRoles.withTransaction(tx).save(...);
//   });
@Injectable()
export class TransactionRunner {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
