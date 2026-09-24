import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GracePeriodWarningJob } from './grace-period-warning.job';
import { Loan } from '../schemas/loan.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';

describe('GracePeriodWarningJob', () => {
  let job: GracePeriodWarningJob;
  let loanModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  const fixedToday = new Date('2026-04-10T00:00:00.000Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(fixedToday);

    loanModel = { find: jest.fn(), updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GracePeriodWarningJob,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<GracePeriodWarningJob>(GracePeriodWarningJob);
  });

  afterEach(() => jest.useRealTimers());

  const makeLoan = () => ({
    _id: { toString: () => 'loan-1' },
    staffId: 'staff-1',
    guarantorId: 'guarantor-1',
    principalAmount: 7000,
    endOfTenureGraceExpiry: new Date('2026-04-17T00:00:00.000Z'),
  });

  it('emails both the defaulter and the guarantor and marks the loan warned', async () => {
    const loan = makeLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com' }) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: 'ama@example.com' }) });

    await job.sendGracePeriodWarnings();

    expect(emailService.send).toHaveBeenCalledTimes(2);
    expect(loanModel.updateOne).toHaveBeenCalledWith(
      { _id: loan._id },
      { $set: { gracePeriodWarningSentAt: expect.any(Date) } },
    );
  });

  it('still marks the loan warned when the guarantor has no email but the defaulter does', async () => {
    const loan = makeLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com' }) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: undefined }) });

    await job.sendGracePeriodWarnings();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(loanModel.updateOne).toHaveBeenCalled();
  });
});
