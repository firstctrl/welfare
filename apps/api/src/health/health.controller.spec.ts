import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { HealthController } from './health.controller';
import { REDIS_CLIENT } from '../cache/redis.module';
import { MINIO_CLIENT } from '../storage/minio.module';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';

function mockResponse() {
  return { status: jest.fn() } as any;
}

describe('HealthController', () => {
  let controller: HealthController;
  let mongoConnection: { readyState: number };
  let redis: { ping: jest.Mock };
  let minioClient: { listBuckets: jest.Mock };
  let meilisearchClient: { health: jest.Mock };

  beforeEach(async () => {
    mongoConnection = { readyState: 1 };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };
    minioClient = { listBuckets: jest.fn().mockResolvedValue([]) };
    meilisearchClient = { health: jest.fn().mockResolvedValue({ status: 'available' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: mongoConnection },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: MINIO_CLIENT, useValue: minioClient },
        { provide: MEILISEARCH_CLIENT, useValue: meilisearchClient },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok with all services up and does not set an error status', async () => {
    const res = mockResponse();
    const result = await controller.check(res);

    expect(result.status).toBe('ok');
    expect(result.services).toEqual({ mongodb: 'up', redis: 'up', minio: 'up', meilisearch: 'up' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('reports degraded and sets a 503 when mongodb is disconnected', async () => {
    mongoConnection.readyState = 0;
    const res = mockResponse();
    const result = await controller.check(res);

    expect(result.status).toBe('degraded');
    expect(result.services.mongodb).toBe('down');
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('reports redis down when ping rejects', async () => {
    redis.ping.mockRejectedValue(new Error('connection refused'));
    const res = mockResponse();
    const result = await controller.check(res);

    expect(result.services.redis).toBe('down');
    expect(result.status).toBe('degraded');
  });

  it('reports minio down when listBuckets rejects', async () => {
    minioClient.listBuckets.mockRejectedValue(new Error('unreachable'));
    const res = mockResponse();
    const result = await controller.check(res);

    expect(result.services.minio).toBe('down');
  });

  it('reports meilisearch down when health rejects', async () => {
    meilisearchClient.health.mockRejectedValue(new Error('unreachable'));
    const res = mockResponse();
    const result = await controller.check(res);

    expect(result.services.meilisearch).toBe('down');
  });
});
