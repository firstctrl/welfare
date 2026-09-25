import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GuarantorRestitutionReminderJob } from './guarantor-restitution-reminder.job';
import { Loan } from '../../loans/schemas/loan.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';
import { StaffStatus } from '@welfare/shared';

describe('GuarantorRestitutionReminderJob', () => {
  let job: GuarantorRestitutionReminderJob;
  let loanModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  beforeEach(async () => {
    loanModel = { find: jest.fn() };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuarantorRestitutionReminderJob,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<GuarantorRestitutionReminderJob>(GuarantorRestitutionReminderJob);
  });

  it('emails every guarantor with unresolved restitution, every run, with no persisted send-marker', async () => {
    const loan = {
      _id: { toString: () => 'loan-1' },
      staffId: 'staff-1',
      guarantorId: 'guarantor-1',
      guarantorRestitutionOwed: 1000,
      guarantorRestitutionPaid: 300,
    };
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: 'ama@example.com', status: StaffStatus.Active }) });

    await job.sendRestitutionReminders();
    await job.sendRestitutionReminders();

    expect(emailService.send).toHaveBeenCalledTimes(2);
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'guarantor-1' }),
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
  });

  it('skips guarantors who have already been fully restituted', async () => {
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendRestitutionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('only queries loans still Active or Defaulted, not written-off or bad-debt loans that can never be restituted', async () => {
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendRestitutionReminders();

    const query = loanModel.find.mock.calls[0][0];
    expect(query.status.$in).toEqual(['Active', 'Defaulted']);
  });

  it('skips a guarantor who is no longer Active staff', async () => {
    const loan = {
      _id: { toString: () => 'loan-1' },
      staffId: 'staff-1',
      guarantorId: 'guarantor-1',
      guarantorRestitutionOwed: 1000,
      guarantorRestitutionPaid: 300,
    };
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: 'ama@example.com', status: StaffStatus.Deceased }) });

    await job.sendRestitutionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
  });
});
