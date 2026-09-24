import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MissedContributionReminderJob } from './missed-contribution-reminder.job';
import { Contribution } from '../schemas/contribution.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';

describe('MissedContributionReminderJob', () => {
  let job: MissedContributionReminderJob;
  let contributionModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  const fixedToday = new Date('2026-04-10T00:00:00.000Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(fixedToday);

    contributionModel = {
      find: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ PAYMENT_DEADLINE_DAY: { value: '5' }, EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissedContributionReminderJob,
        { provide: getModelToken(Contribution.name), useValue: contributionModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<MissedContributionReminderJob>(MissedContributionReminderJob);
  });

  afterEach(() => jest.useRealTimers());

  it('emails staff with a missed contribution this month and marks it sent', async () => {
    const row = {
      _id: { toString: () => 'contrib-1' },
      staffId: 'staff-1',
      expectedAmount: 200,
      month: 4,
      year: 2026,
    };
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([row]) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Ama Owusu', email: 'ama@example.com' }) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(contributionModel.updateOne).toHaveBeenCalledWith(
      { _id: row._id },
      { $set: { reminderSentAt: expect.any(Date) } },
    );
  });

  it('skips staff with no email and does not mark the reminder sent', async () => {
    const row = { _id: { toString: () => 'contrib-2' }, staffId: 'staff-2', expectedAmount: 200, month: 4, year: 2026 };
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([row]) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-2' }, fullName: 'No Email', email: undefined }) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
    expect(contributionModel.updateOne).not.toHaveBeenCalled();
  });

  it('does nothing before the payment deadline day has passed', async () => {
    jest.setSystemTime(new Date('2026-04-03T00:00:00.000Z'));

    await job.sendMissedContributionReminders();

    expect(contributionModel.find).not.toHaveBeenCalled();
  });
});
