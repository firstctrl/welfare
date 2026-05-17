import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { validateConfig } from './config/configuration';
import { UsersService } from './users/users.service';

async function bootstrap() {
  validateConfig();
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.CORS_ORIGIN || false });

  const usersService = app.get(UsersService);
  await usersService.seedAdminIfEmpty();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 4000;
  await app.listen(port);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
