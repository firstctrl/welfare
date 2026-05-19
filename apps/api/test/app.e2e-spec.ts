import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SanitizePipe } from '../src/common/pipes/sanitize.pipe';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.MONGODB_URI =
      process.env.MONGODB_URI || 'mongodb://localhost:27017/welfare-test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new SanitizePipe(),
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('returns 401 with invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'nobody', password: 'wrong' })
        .expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        code: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('returns standardised error shape on 400 (missing body)', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('statusCode', 400);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /health', () => {
    it('returns 200 without auth', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });

  describe('GET /staff (protected)', () => {
    it('returns 401 without token', async () => {
      const response = await request(app.getHttpServer())
        .get('/staff')
        .expect(401);
      expect(response.body.statusCode).toBe(401);
      expect(response.body.code).toBeDefined();
    });
  });

  describe('GET /audit (protected)', () => {
    it('returns 401 without token', async () => {
      const response = await request(app.getHttpServer())
        .get('/audit')
        .expect(401);
      expect(response.body.statusCode).toBe(401);
    });
  });
});
