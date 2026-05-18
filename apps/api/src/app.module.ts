import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './cache/redis.module';
import { MinioModule } from './storage/minio.module';
import { MeilisearchModule } from './search/meilisearch.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AuditModule } from './audit/audit.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { StaffModule } from './staff/staff.module';
import { SearchModule } from './search/search.module';

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
    AuthModule,
    AuditModule,
    SystemConfigModule,
    StaffModule,
    SearchModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
