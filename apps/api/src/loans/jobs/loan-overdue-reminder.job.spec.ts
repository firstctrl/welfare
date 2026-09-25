import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoanOverdueReminderJob } from './loan-overdue-reminder.job';
import { LoanRepayment } from '../schemas/loan-repayment.schema';
import { Loan } from '../schemas/loan.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';
import { EmailLogStatus, LoanStatus, StaffStatus } from '@welfare/shared';

describe('LoanOverdueReminderJob', () => {
  let job: LoanOverdueReminderJob;
  let repaymentModel: any;
  let loanModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  beforeEach(async () => {
    repaymentModel = { find: jest.fn(), updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    loanModel = { findById: jest.fn() };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(EmailLogStatus.Sent) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanOverdueReminderJob,
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<LoanOverdueReminderJob>(LoanOverdueReminderJob);
  });

  const makeInst = () => ({
    _id: { toString: () => 'inst-1' },
    loanId: 'loan-1',
    staffId: 'staff-1',
    instalmentNumber: 1,
    dueAmount: 3500,
    penaltyAmount: 500,
    paidAmount: 0,
  });

  it('emails the borrower for a newly-overdue instalment and marks it sent', async () => {
    const inst = makeInst();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' }, status: LoanStatus.Active }) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com', status: StaffStatus.Active }) });

    await job.sendOverdueReminders();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(repaymentModel.updateOne).toHaveBeenCalledWith(
      { _id: inst._id },
      { $set: { overdueReminderSentAt: expect.any(Date) } },
    );
  });

  it('skips instalments on a loan that is no longer Active', async () => {
    const inst = makeInst();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' }, status: LoanStatus.Completed }) });

    await job.sendOverdueReminders();

    expect(emailService.send).not.toHaveBeenCalled();
    expect(repaymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('skips a borrower who is no longer Active staff', async () => {
    const inst = makeInst();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' }, status: LoanStatus.Active }) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com', status: StaffStatus.Resigned }) });

    await job.sendOverdueReminders();

    expect(emailService.send).not.toHaveBeenCalled();
    expect(repaymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('does not mark the instalment sent when the email send fails', async () => {
    const inst = makeInst();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' }, status: LoanStatus.Active }) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com', status: StaffStatus.Active }) });
    emailService.send.mockResolvedValue(EmailLogStatus.Failed);

    await job.sendOverdueReminders();

    expect(repaymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('only queries instalments overdue within the lookback window, not every Overdue row ever', async () => {
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendOverdueReminders();

    expect(repaymentModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: expect.any(Object) }),
    );
  });
});
