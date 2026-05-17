import { Controller, Get, Inject, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Response } from 'express';
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
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [mongodb, redis, minio, meilisearch] = await Promise.all([
      this.checkMongoDB(),
      this.checkRedis(),
      this.checkMinio(),
      this.checkMeilisearch(),
    ]);
    const services = { mongodb, redis, minio, meilisearch };

    const allUp = Object.values(services).every((s) => s === 'up');
    const status = allUp ? 'ok' : 'degraded';
    if (!allUp) res.status(503);

    return {
      status,
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
    let id: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        id = setTimeout(() => reject(new Error('Redis ping timeout')), 3000);
      });
      await Promise.race([this.redis.ping(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(id);
    }
  }

  private async checkMinio(): Promise<ServiceStatus> {
    let id: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        id = setTimeout(() => reject(new Error('MinIO timeout')), 3000);
      });
      await Promise.race([this.minioClient.listBuckets(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(id);
    }
  }

  private async checkMeilisearch(): Promise<ServiceStatus> {
    let id: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        id = setTimeout(() => reject(new Error('Meilisearch timeout')), 3000);
      });
      await Promise.race([this.meilisearchClient.health(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(id);
    }
  }
}
