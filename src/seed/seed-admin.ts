// `npm run seed:admin`: creates the first platform admin from environment variables.
//
//   BOOTSTRAP_ADMIN_EMAIL     required
//   BOOTSTRAP_ADMIN_PASSWORD  required, 12-128 characters
//   BOOTSTRAP_ADMIN_NAME      optional, default "Platform Admin"
//
// Run it after `npm run db:migrate`. If an active platform admin already exists it does nothing,
// so running it again is safe. It is not a migration: the password must never be in git,
// and each environment (local, staging, prod) sets its own admin.
import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { UsersService } from '../users/users.service.js';

async function main(): Promise<void> {
  // Builds all modules and connects to the database, but starts no HTTP server.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const config = app.get(ConfigService);
    const email = config.getOrThrow<string>('BOOTSTRAP_ADMIN_EMAIL');
    const result = await app.get(UsersService).ensurePlatformAdmin({
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
    await app.close(); // closes the database connection so the process can exit
  }
}

main().catch((error: unknown) => {
  console.error(
    'seed:admin failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
