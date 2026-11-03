import { NestFactory } from '@nestjs/core';

import { configureApp } from './app.setup.js';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
