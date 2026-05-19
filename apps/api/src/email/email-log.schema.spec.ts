import { EmailLog, EmailLogSchema } from './email-log.schema';
import { EmailLogStatus, EmailLogType, EmailProvider, EmailTriggerSource } from '@welfare/shared';

describe('EmailLog schema', () => {
  it('exports EmailLog class and schema', () => {
    expect(EmailLog).toBeDefined();
    expect(EmailLogSchema).toBeDefined();
  });

  it('schema has required paths', () => {
    const paths = Object.keys(EmailLogSchema.paths);
    expect(paths).toContain('recipient');
    expect(paths).toContain('type');
    expect(paths).toContain('status');
    expect(paths).toContain('provider');
    const recipientPaths = Object.keys((EmailLogSchema.path('recipient') as any).schema.paths);
    expect(recipientPaths).toContain('staffId');
    expect(recipientPaths).toContain('email');
  });
});
