import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EmailService } from './email.service';
import { EmailLog } from './email-log.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { EmailLogStatus, EmailLogType, EmailTriggerSource } from '@welfare/shared';

const mockLogCreate = jest.fn();
const mockEmailLogModel = {
  create: mockLogCreate,
  find: jest.fn(),
  countDocuments: jest.fn(),
};

const mockConfigGetAll = jest.fn();
const mockConfigService = { getAll: mockConfigGetAll };

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn() }),
}));

beforeEach(() => jest.clearAllMocks());

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: getModelToken(EmailLog.name), useValue: mockEmailLogModel },
        { provide: SystemConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<EmailService>(EmailService);
  });

  describe('send via resend', () => {
    it('calls resend SDK and logs Sent', async () => {
      const { Resend } = jest.requireMock<{ Resend: jest.Mock }>('resend');
      const mockSend = jest.fn().mockResolvedValue({ data: { id: 'abc' }, error: null });
      Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

      mockConfigGetAll.mockResolvedValue({
        EMAIL_PROVIDER: { value: 'resend' },
        RESEND_API_KEY: { value: 'test-key' },
        EMAIL_FROM_ADDRESS: { value: 'noreply@test.com' },
        EMAIL_FROM_NAME: { value: 'Test Welfare' },
      });
      mockLogCreate.mockResolvedValue({});

      await service.send(
        { staffId: 's1', staffName: 'Alice', email: 'alice@test.com' },
        EmailLogType.LoanSchedule,
        'Test Subject',
        '<p>Hello</p>',
        EmailTriggerSource.Manual,
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@test.com', subject: 'Test Subject' }),
      );
      expect(mockLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ status: EmailLogStatus.Sent }),
      );
    });
  });

  describe('send via smtp', () => {
    it('calls nodemailer sendMail and logs Sent', async () => {
      const nodemailer = jest.requireMock<typeof import('nodemailer')>('nodemailer');
      const mockSendMail = jest.fn().mockResolvedValue({});
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });

      mockConfigGetAll.mockResolvedValue({
        EMAIL_PROVIDER: { value: 'smtp' },
        OUTLOOK_HOST: { value: 'smtp.office365.com' },
        OUTLOOK_PORT: { value: '587' },
        OUTLOOK_USERNAME: { value: 'user@test.com' },
        OUTLOOK_PASSWORD: { value: 'secret' },
        EMAIL_FROM_ADDRESS: { value: 'noreply@test.com' },
        EMAIL_FROM_NAME: { value: 'Test Welfare' },
      });
      mockLogCreate.mockResolvedValue({});

      await service.send(
        { staffId: 's2', staffName: 'Bob', email: 'bob@test.com' },
        EmailLogType.ContributionStatement,
        'Statement',
        '<p>Hi Bob</p>',
        EmailTriggerSource.Cron,
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'bob@test.com', subject: 'Statement' }),
      );
      expect(mockLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ status: EmailLogStatus.Sent }),
      );
    });
  });

  describe('send failure handling', () => {
    it('logs Failed and does NOT throw', async () => {
      const { Resend } = jest.requireMock<{ Resend: jest.Mock }>('resend');
      const mockSend = jest.fn().mockRejectedValue(new Error('provider error'));
      Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

      mockConfigGetAll.mockResolvedValue({
        EMAIL_PROVIDER: { value: 'resend' },
        RESEND_API_KEY: { value: 'bad-key' },
        EMAIL_FROM_ADDRESS: { value: 'noreply@test.com' },
        EMAIL_FROM_NAME: { value: 'Test' },
      });
      mockLogCreate.mockResolvedValue({});

      await expect(
        service.send(
          { staffId: 's3', staffName: 'Charlie', email: 'charlie@test.com' },
          EmailLogType.LoanSchedule,
          'Subject',
          '<p>Hi</p>',
          EmailTriggerSource.Manual,
        ),
      ).resolves.not.toThrow();

      expect(mockLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ status: EmailLogStatus.Failed }),
      );
    });
  });
});
