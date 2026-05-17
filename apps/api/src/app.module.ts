import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './cache/redis.module';
import { MinioModule } from './storage/minio.module';
import { MeilisearchModule } from './search/meilisearch.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60, limit: 100 }]),
    DatabaseModule,
    RedisModule,
    MinioModule,
    MeilisearchModule,
    EmailModule,
    HealthModule,
    UsersModule,
  ],
})
export class AppModule {}
