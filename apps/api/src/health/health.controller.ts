import { Controller, Get, Inject } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import Redis from 'ioredis';
import { Client as MinioClient } from 'minio';
import { MeiliSearch } from 'meilisearch';
import { REDIS_CLIENT } from '../cache/redis.module';
import { MINIO_CLIENT } from '../storage/minio.module';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';

type ServiceStatus = 'up' | 'down';

interface HealthResponse {
  status: 'ok' | 'degraded';
  services: {
    mongodb: ServiceStatus;
    redis: ServiceStatus;
    minio: ServiceStatus;
    meilisearch: ServiceStatus;
  };
  timestamp: string;
}

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    @Inject(MEILISEARCH_CLIENT) private readonly meilisearchClient: MeiliSearch,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const services = {
      mongodb: await this.checkMongoDB(),
      redis: await this.checkRedis(),
      minio: await this.checkMinio(),
      meilisearch: await this.checkMeilisearch(),
    };

    const allUp = Object.values(services).every((s) => s === 'up');

    return {
      status: allUp ? 'ok' : 'degraded',
      services,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkMongoDB(): Promise<ServiceStatus> {
    try {
      return this.mongoConnection.readyState === 1 ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async checkMinio(): Promise<ServiceStatus> {
    try {
      await this.minioClient.listBuckets();
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkMeilisearch(): Promise<ServiceStatus> {
    try {
      await this.meilisearchClient.health();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
