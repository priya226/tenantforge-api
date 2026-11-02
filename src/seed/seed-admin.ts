import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { FeatureFlagFacade } from '../api/feature-flag.facade.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const config = app.get(ConfigService);
    const email = config.getOrThrow<string>('BOOTSTRAP_ADMIN_EMAIL');
    const result = await app.get(FeatureFlagFacade).ensurePlatformAdmin({
      name: config.get<string>('BOOTSTRAP_ADMIN_NAME') ?? 'Platform Admin',
      email,
      password: config.getOrThrow<string>('BOOTSTRAP_ADMIN_PASSWORD'),
    });

    console.log(
      result === 'created'
        ? `Platform admin created: ${email.trim().toLowerCase()}`
        : 'A platform admin already exists. Nothing to do.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    'seed:admin failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
