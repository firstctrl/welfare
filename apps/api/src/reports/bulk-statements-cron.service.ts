import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StaffStatus } from '@welfare/shared';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { SystemConfigService } from '../system-config/system-config.service';

function matchesCronDay(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dom, month, dow] = parts;
  const nowMonth = now.getMonth() + 1;
  const nowDay = now.getDate();
  const nowDow = now.getDay();

  const matches = (field: string, val: number): boolean => {
    if (field === '*') return true;
    return field.split(',').some(p => parseInt(p, 10) === val);
  };

  return matches(dom, nowDay) && matches(month, nowMonth) && matches(dow, nowDow);
}

@Injectable()
export class BulkStatementsCronService {
  private readonly logger = new Logger(BulkStatementsCronService.name);

  constructor(
    @InjectQueue('bulk-statements') private readonly queue: Queue,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
  ) {}

  // Runs daily at 8 AM; checks if today matches the configured schedule.
  @Cron('0 8 * * *')
  async maybeSendStatements(): Promise<void> {
    const config = await this.configService.getAll();
    const expr = config['EMAIL_CONTRIBUTION_STATEMENT_CRON']?.value;

    if (!expr || !matchesCronDay(expr, new Date())) {
      return;
    }

    const year = new Date().getFullYear();
    const staffWithEmail = await this.staffModel
      .find({ status: StaffStatus.Active, email: { $exists: true, $ne: '' } })
      .select('_id')
      .lean()
      .exec();

    if (staffWithEmail.length === 0) {
      this.logger.log('Scheduled bulk send: no active staff with email, skipping');
      return;
    }

    const staffIds = (staffWithEmail as any[]).map((s: any) => s._id.toString());
    const job = await this.queue.add('bulk-send', { staffIds, year, triggeredBy: 'cron' });
    this.logger.log(`Scheduled bulk send queued: ${staffIds.length} staff, job ${job.id}`);
  }
}
