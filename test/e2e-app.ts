import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';

import { FeatureFlagFacade } from '../src/api/feature-flag.facade.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

export const ADMIN = {
  name: 'E2E Platform Admin',
  email: 'admin@e2e.test',
  password: 'e2e-admin-password-1',
};

export async function createE2eApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = configureApp(
    moduleRef.createNestApplication<INestApplication<App>>(),
  );
  await app.init();
  return app;
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const database = String(dataSource.options.database);
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to reset "${database}": not a test database`);
  }
  await dataSource.query(
    'TRUNCATE refresh_token, user_role, app_user, company RESTART IDENTITY',
  );
  await app.get(FeatureFlagFacade).ensurePlatformAdmin(ADMIN);
}

export async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body as { accessToken: string; refreshToken: string };
}
