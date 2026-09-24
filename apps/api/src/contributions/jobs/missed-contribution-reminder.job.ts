import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigKey, ContributionStatus, EmailLogType, EmailTriggerSource, IEmailRecipient } from '@welfare/shared';
import { Contribution, ContributionDocument } from '../schemas/contribution.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderMissedContributionReminder } from '../../email/templates/contribution-missed-reminder.template';

type ConfigMap = Record<string, { value: string }>;

@Injectable()
export class MissedContributionReminderJob {
  private readonly logger = new Logger(MissedContributionReminderJob.name);

  constructor(
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
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

    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const missed = await this.contributionModel
      .find({ status: ContributionStatus.Missed, month, year, reminderSentAt: { $exists: false } })
      .exec();

    this.logger.log(`Found ${missed.length} missed contributions for ${month}/${year}`);

    for (const row of missed) {
      try {
        const staff = await this.staffModel.findById(row.staffId).exec();
        if (!staff?.email) continue;

        const html = renderMissedContributionReminder({
          staffName: staff.fullName,
          expectedAmount: row.expectedAmount,
          month,
          year,
          organisationName,
        });

        const recipient: IEmailRecipient = {
          staffId: staff._id.toString(),
          staffName: staff.fullName,
          email: staff.email,
        };
        await this.emailService.send(
          recipient,
          EmailLogType.MissedContributionReminder,
          `Missed Contribution Reminder - ${month}/${year}`,
          html,
          EmailTriggerSource.Cron,
        );

        await this.contributionModel.updateOne({ _id: row._id }, { $set: { reminderSentAt: new Date() } }).exec();
      } catch (err) {
        this.logger.error(`Reminder failed for contribution ${row._id.toString()}`, err);
      }
    }

    this.logger.log('Missed contribution reminder job complete');
  }
}
