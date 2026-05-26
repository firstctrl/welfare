import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';
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
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { AuditModule } from './audit/audit.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { StaffModule } from './staff/staff.module';
import { SearchModule } from './search/search.module';
import { ContributionsModule } from './contributions/contributions.module';
import { LoansModule } from './loans/loans.module';
import { ReportsModule } from './reports/reports.module';
import { RemittancesModule } from './remittances/remittances.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: cs.get<string>('redis.host') || 'localhost',
            port: cs.get<number>('redis.port') || 6379,
            lazyConnect: true,
          }),
        ),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        connection: {
          host: cs.get<string>('redis.host'),
          port: cs.get<number>('redis.port'),
        },
      }),
    }),
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
    ContributionsModule,
    LoansModule,
    RemittancesModule,
    ReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
