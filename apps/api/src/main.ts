import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateConfig } from './config/configuration';
import { UsersService } from './users/users.service';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { SanitizePipe } from './common/pipes/sanitize.pipe';

async function bootstrap() {
  validateConfig();
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({
    origin: process.env.CORS_ORIGIN || false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new SanitizePipe(),
    new ValidationPipe({ whitelist: true, transform: true }),
  );

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
