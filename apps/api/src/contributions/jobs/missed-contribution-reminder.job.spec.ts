import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MissedContributionReminderJob } from './missed-contribution-reminder.job';
import { Contribution } from '../schemas/contribution.schema';
import { ContributionReminderLog } from '../schemas/contribution-reminder-log.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';
import { EmailLogStatus, StaffStatus } from '@welfare/shared';

describe('MissedContributionReminderJob', () => {
  let job: MissedContributionReminderJob;
  let contributionModel: any;
  let reminderLogModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  // Today is 10 May 2026 — the job checks the PREVIOUS month (April) once
  // the deadline day has passed this month, mirroring how the rest of the
  // app (ReportsService.computeMissedCounts) treats a month as overdue only
  // once we're into the following month.
  const fixedToday = new Date('2026-05-10T00:00:00.000Z');

  const eligibleStaff = (id: string, overrides: Record<string, unknown> = {}) => ({
    _id: { toString: () => id },
    fullName: `Staff ${id}`,
    email: `${id}@example.com`,
    status: StaffStatus.Active,
    dateOfFirstContribution: new Date('2020-01-01'),
    dateOfEmployment: new Date('2019-01-01'),
    ...overrides,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(fixedToday);

    contributionModel = { find: jest.fn() };
    reminderLogModel = { find: jest.fn(), create: jest.fn().mockResolvedValue({}) };
    staffModel = { find: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ PAYMENT_DEADLINE_DAY: { value: '5' }, EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(EmailLogStatus.Sent) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissedContributionReminderJob,
        { provide: getModelToken(Contribution.name), useValue: contributionModel },
        { provide: getModelToken(ContributionReminderLog.name), useValue: reminderLogModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<MissedContributionReminderJob>(MissedContributionReminderJob);
  });

  afterEach(() => jest.useRealTimers());

  it('emails an eligible Active staff member who has no contribution document for the previous month, and logs it', async () => {
    staffModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([eligibleStaff('staff-1')]) });
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }); // nobody has a April doc
    reminderLogModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }); // nobody already reminded

    await job.sendMissedContributionReminders();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-1' }),
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
    expect(reminderLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-1', month: 4, year: 2026 }),
    );
  });

  it('does not email a staff member who already has a contribution document for the previous month', async () => {
    staffModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([eligibleStaff('staff-1')]) });
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ staffId: 'staff-1' }]) });
    reminderLogModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does not email a staff member already reminded for that month', async () => {
    staffModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([eligibleStaff('staff-1')]) });
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    reminderLogModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ staffId: 'staff-1', month: 4, year: 2026 }]) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does not email a staff member not yet eligible in the target month (joined after it)', async () => {
    staffModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        eligibleStaff('staff-1', { dateOfFirstContribution: undefined, dateOfEmployment: new Date('2026-05-01') }),
      ]),
    });
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    reminderLogModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does not email a non-Active staff member', async () => {
    staffModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([eligibleStaff('staff-1', { status: StaffStatus.Resigned })]) });
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    reminderLogModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does not log the reminder when the email send fails', async () => {
    staffModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([eligibleStaff('staff-1')]) });
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    reminderLogModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    emailService.send.mockResolvedValue(EmailLogStatus.Failed);

    await job.sendMissedContributionReminders();

    expect(reminderLogModel.create).not.toHaveBeenCalled();
  });

  it('does nothing before the payment deadline day has passed this month', async () => {
    jest.setSystemTime(new Date('2026-05-03T00:00:00.000Z'));

    await job.sendMissedContributionReminders();

    expect(staffModel.find).not.toHaveBeenCalled();
  });
});
