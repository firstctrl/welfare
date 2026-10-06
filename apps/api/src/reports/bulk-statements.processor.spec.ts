import { BulkStatementsProcessor } from './bulk-statements.processor';

describe('BulkStatementsProcessor', () => {
  const staff = { fullName: 'Ama Mensah', staffId: 'S001', email: 'ama@example.com' };
  let staffModel: any;
  let reportsService: any;
  let emailService: any;
  let processor: BulkStatementsProcessor;

  beforeEach(() => {
    staffModel = { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(staff) }) };
    reportsService = { generateStatementPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    emailService = { sendWithAttachment: jest.fn().mockResolvedValue(undefined) };
    processor = new BulkStatementsProcessor(staffModel, reportsService, emailService);
  });

  const job = (data: any) => ({ data, updateProgress: jest.fn() }) as any;

  it('scopes the statement to the selected year on manual send', async () => {
    await processor.process(job({ staffIds: ['a'], year: 2025, triggeredBy: 'manual' }));

    expect(reportsService.generateStatementPdf).toHaveBeenCalledWith('a', 2025);
    const [, subject, , attachments] = emailService.sendWithAttachment.mock.calls[0];
    expect(subject).toContain('2025');
    expect(attachments[0].filename).toBe('statement-S001-2025.pdf');
  });

  it('sends the full statement when no year is given (scheduled send)', async () => {
    await processor.process(job({ staffIds: ['a'], triggeredBy: 'cron' }));

    expect(reportsService.generateStatementPdf).toHaveBeenCalledWith('a', undefined);
    const [, subject, body, attachments] = emailService.sendWithAttachment.mock.calls[0];
    expect(subject).toBe('Your Welfare Department Contribution Statement');
    expect(body).not.toContain('undefined');
    expect(attachments[0].filename).toBe('statement-S001.pdf');
  });
});
