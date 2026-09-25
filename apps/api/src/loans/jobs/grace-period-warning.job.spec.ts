import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GracePeriodWarningJob } from './grace-period-warning.job';
import { Loan } from '../schemas/loan.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';
import { EmailLogStatus, StaffStatus } from '@welfare/shared';

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
    emailService = { send: jest.fn().mockResolvedValue(EmailLogStatus.Sent) };

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

  const activeStaff = (id: string, name: string, email: string | undefined = `${id}@example.com`) => ({
    _id: { toString: () => id },
    fullName: name,
    email,
    status: StaffStatus.Active,
  });

  it('emails both the defaulter and the guarantor and marks the loan warned', async () => {
    const loan = makeLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(activeStaff('staff-1', 'Kofi Mensah', 'kofi@example.com')) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(activeStaff('guarantor-1', 'Ama Owusu', 'ama@example.com')) });

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
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(activeStaff('staff-1', 'Kofi Mensah', 'kofi@example.com')) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ ...activeStaff('guarantor-1', 'Ama Owusu'), email: undefined }) });

    await job.sendGracePeriodWarnings();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(loanModel.updateOne).toHaveBeenCalled();
  });

  it('skips a recipient who is no longer Active staff', async () => {
    const loan = makeLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ ...activeStaff('staff-1', 'Kofi Mensah'), status: StaffStatus.Resigned }) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(activeStaff('guarantor-1', 'Ama Owusu')) });

    await job.sendGracePeriodWarnings();

    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('does not mark the loan warned when every send fails', async () => {
    const loan = makeLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(activeStaff('staff-1', 'Kofi Mensah')) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(activeStaff('guarantor-1', 'Ama Owusu')) });
    emailService.send.mockResolvedValue(EmailLogStatus.Failed);

    await job.sendGracePeriodWarnings();

    expect(loanModel.updateOne).not.toHaveBeenCalled();
  });

  it('queries a from-today-through-7-days-out window, not an exact single day, so a defaulted loan with a short grace period is not skipped', async () => {
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendGracePeriodWarnings();

    const query = loanModel.find.mock.calls[0][0];
    expect(query.endOfTenureGraceExpiry.$gte.toISOString().slice(0, 10)).toBe('2026-04-10');
    expect(query.endOfTenureGraceExpiry.$lte.toISOString().slice(0, 10)).toBe('2026-04-17');
  });
});
