import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigKey, EmailLogStatus, EmailLogType, EmailTriggerSource, IEmailRecipient, StaffStatus } from '@welfare/shared';
import { Contribution, ContributionDocument } from '../schemas/contribution.schema';
import { ContributionReminderLog, ContributionReminderLogDocument } from '../schemas/contribution-reminder-log.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderMissedContributionReminder } from '../../email/templates/contribution-missed-reminder.template';

type ConfigMap = Record<string, { value: string }>;

function getPrevMonthYear(month: number, year: number): { month: number; year: number } {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

/**
 * A "missed" contribution is an ABSENT Contribution document for an eligible
 * staff-month, not a status value on an existing one — nothing in the app
 * ever creates a document with ContributionStatus.Missed. This mirrors the
 * definition ReportsService.computeMissedCounts already uses.
 */
@Injectable()
export class MissedContributionReminderJob {
  private readonly logger = new Logger(MissedContributionReminderJob.name);

  constructor(
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    @InjectModel(ContributionReminderLog.name) private readonly reminderLogModel: Model<ContributionReminderLogDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('30 0 * * *')
  async sendMissedContributionReminders(): Promise<void> {
    this.logger.log('Starting missed contribution reminder job');

    const config = (await this.configService.getAll()) as unknown as ConfigMap;
    const deadlineDay = parseInt(config[ConfigKey.PaymentDeadlineDay]?.value ?? '5', 10);
    const today = new Date();
    if (today.getDate() <= deadlineDay) {
      this.logger.log('Payment deadline has not passed this month — skipping');
      return;
    }

    // The month being checked is always the previous one — this month's
    // contribution isn't due to have landed yet.
    const { month, year } = getPrevMonthYear(today.getMonth() + 1, today.getFullYear());
    const monthEnd = new Date(year, month, 0, 23, 59, 59);
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const [staffDocs, docsForMonth, alreadyReminded] = await Promise.all([
      this.staffModel.find().exec(),
      this.contributionModel.find({ month, year, isDebit: { $ne: true } }).exec(),
      this.reminderLogModel.find({ month, year }).exec(),
    ]);

    const staffIdsWithDoc = new Set(docsForMonth.map(d => d.staffId));
    const staffIdsReminded = new Set(alreadyReminded.map(r => r.staffId));

    const missing = staffDocs.filter(staff => {
      const staffId = staff._id.toString();
      if (staffIdsWithDoc.has(staffId) || staffIdsReminded.has(staffId)) return false;
      if (staff.status !== StaffStatus.Active) return false;
      const start = staff.dateOfFirstContribution ?? staff.dateOfEmployment;
      if (!start || new Date(start) > monthEnd) return false;
      return true;
    });

    this.logger.log(`Found ${missing.length} staff missing a contribution for ${month}/${year}`);

    for (const staff of missing) {
      try {
        if (!staff.email) continue;

        const html = renderMissedContributionReminder({
          staffName: staff.fullName,
          month,
          year,
          organisationName,
        });

        const recipient: IEmailRecipient = {
          staffId: staff._id.toString(),
          staffName: staff.fullName,
          email: staff.email,
        };
        const status = await this.emailService.send(
          recipient,
          EmailLogType.MissedContributionReminder,
          `Missed Contribution Reminder - ${month}/${year}`,
          html,
          EmailTriggerSource.Cron,
        );

        if (status === EmailLogStatus.Sent) {
          await this.reminderLogModel.create({ staffId: staff._id.toString(), month, year, sentAt: new Date() });
        }
      } catch (err) {
        this.logger.error(`Reminder failed for staff ${staff._id.toString()}`, err);
      }
    }

    this.logger.log('Missed contribution reminder job complete');
  }
}
