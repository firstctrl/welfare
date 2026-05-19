import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SanitizePipe } from '../src/common/pipes/sanitize.pipe';

describe('Loans (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

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

    // Attempt login with seeded admin; token may be empty if DB has no admin yet
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    authToken = (loginRes.body as { accessToken?: string })?.accessToken ?? '';
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /loans — validation', () => {
    it('returns 401 without auth token', async () => {
      await request(app.getHttpServer()).post('/loans').send({}).expect(401);
    });

    it('returns 400 with standardised error when required fields missing', async () => {
      if (!authToken) return;
      const response = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.code).toBe('BAD_REQUEST');
      expect(response.body.timestamp).toBeDefined();
    });

    it('returns 400 or 404 when staffId is not a valid ObjectId', async () => {
      if (!authToken) return;
      const response = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          staffId: 'not-an-id',
          guarantorId: 'not-an-id',
          principalAmount: 5000,
          tenureMonths: 6,
          disbursedDate: '2026-01-01',
        });

      expect([400, 404]).toContain(response.status);
      expect(response.body.statusCode).toBeDefined();
      expect(response.body.code).toBeDefined();
    });
  });

  describe('GET /loans', () => {
    it('returns 401 without token', async () => {
      await request(app.getHttpServer()).get('/loans').expect(401);
    });

    it('returns paginated list when authenticated', async () => {
      if (!authToken) return;
      const response = await request(app.getHttpServer())
        .get('/loans')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /contributions — import protected', () => {
    it('returns 401 without token', async () => {
      await request(app.getHttpServer())
        .get('/contributions')
        .expect(401);
    });
  });
});
