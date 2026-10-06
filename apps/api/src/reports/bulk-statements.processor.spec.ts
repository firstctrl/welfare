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

  // updateData mutates job.data like BullMQ does, so a re-run of the same job sees saved progress.
  const job = (data: any) => {
    const j: any = { data, updateProgress: jest.fn() };
    j.updateData = jest.fn(async (d: any) => { j.data = d; });
    return j;
  };

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

  it('saves its position after each staff member', async () => {
    const j = job({ staffIds: ['a', 'b'], triggeredBy: 'manual' });
    await processor.process(j);

    expect(j.updateData).toHaveBeenCalledTimes(2);
    expect(j.data).toMatchObject({ nextIndex: 2, sent: 2, failed: 0 });
  });

  it('resumes after a restart without re-emailing staff already done', async () => {
    const j = job({ staffIds: ['a', 'b', 'c'], triggeredBy: 'cron', nextIndex: 2, sent: 1, failed: 1 });
    const result = await processor.process(j);

    expect(reportsService.generateStatementPdf).toHaveBeenCalledTimes(1);
    expect(reportsService.generateStatementPdf).toHaveBeenCalledWith('c', undefined);
    expect(result).toEqual({ sent: 2, failed: 1, total: 3 });
  });

  it('keeps its position when a send fails', async () => {
    emailService.sendWithAttachment.mockRejectedValueOnce(new Error('smtp down'));
    const j = job({ staffIds: ['a', 'b'], triggeredBy: 'manual' });
    const result = await processor.process(j);

    expect(result).toEqual({ sent: 1, failed: 1, total: 2 });
    expect(j.data).toMatchObject({ nextIndex: 2, sent: 1, failed: 1 });
  });
});
