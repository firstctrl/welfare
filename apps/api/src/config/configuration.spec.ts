import { validateConfig } from './configuration';

describe('validateConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not throw outside production even when required vars are missing', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    delete process.env.REDIS_HOST;
    delete process.env.JWT_SECRET;
    expect(() => validateConfig()).not.toThrow();
  });

  it('throws when required env vars are missing in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MONGODB_URI;
    process.env.REDIS_HOST = 'redis';
    process.env.JWT_SECRET = 'a-real-secret';
    expect(() => validateConfig()).toThrow(/Missing required environment variables/);
  });

  it('throws when JWT_SECRET is left as the default in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/welfare';
    process.env.REDIS_HOST = 'redis';
    process.env.JWT_SECRET = 'changeme';
    expect(() => validateConfig()).toThrow(/JWT_SECRET must be changed/);
  });

  it('passes in production when all required vars are set and JWT_SECRET is non-default', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/welfare';
    process.env.REDIS_HOST = 'redis';
    process.env.JWT_SECRET = 'a-real-secret';
    expect(() => validateConfig()).not.toThrow();
  });
});
