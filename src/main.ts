import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties that have no decorator in the DTO
      forbidNonWhitelisted: true, // and reject the request if any were sent
      transform: true, // turn the plain JSON body into a DTO class instance
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
