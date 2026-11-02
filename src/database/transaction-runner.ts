import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export type Transaction = EntityManager;

@Injectable()
export class TransactionRunner {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
