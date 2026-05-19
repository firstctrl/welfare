export default () => ({
  port: parseInt(process.env.APP_PORT || '4000', 10),
  mongodb: { uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/welfare' },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'welfare-docs',
  },
  meilisearch: {
    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILISEARCH_API_KEY || 'masterKey',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'changeme',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    rotationSecret: process.env.JWT_SECRET_ROTATION_KEY || '',
  },
  ldap: {
    url: process.env.LDAP_URL || '',
    bindDn: process.env.LDAP_BIND_DN || '',
    bindCredentials: process.env.LDAP_BIND_CREDENTIALS || '',
    searchBase: process.env.LDAP_SEARCH_BASE || '',
  },
  email: {
    provider: process.env.EMAIL_PROVIDER || 'resend',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@welfare.local',
    fromName: process.env.EMAIL_FROM_NAME || 'Welfare System',
    resendApiKey: process.env.RESEND_API_KEY || '',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },
});

export function validateConfig(): void {
  const required = ['MONGODB_URI', 'REDIS_HOST', 'JWT_SECRET', 'LDAP_URL', 'LDAP_BIND_CREDENTIALS'];
  if (process.env.NODE_ENV === 'production') {
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    if (process.env.JWT_SECRET === 'changeme') {
      throw new Error('JWT_SECRET must be changed from the default value in production');
    }
  }
}
