import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import * as nodemailer from 'nodemailer';
import { AuditAction, AuditEntity, ConfigKey } from '@welfare/shared';
import { REDIS_CLIENT } from '../cache/redis.module';
import { AuditService } from '../audit/audit.service';
import { ConfigSetting, ConfigSettingDocument } from './system-config.schema';

type ConfigMap = Record<string, { value: string; updatedBy: string; updatedAt: string }>;

const REDIS_KEY = 'config:all';
const REDIS_TTL = 300; // 5 minutes

const SEED_DEFAULTS: Array<{ key: ConfigKey; value: string; description?: string }> = [
  { key: ConfigKey.MonthlyContributionAmount, value: '100' },
  { key: ConfigKey.LoanMinAmount, value: '500' },
  { key: ConfigKey.LoanMaxAmount, value: '10000' },
  { key: ConfigKey.LoanMaxTenure, value: '24' },
  { key: ConfigKey.InterestRateShort, value: '5' },
  { key: ConfigKey.InterestRateLong, value: '8' },
  { key: ConfigKey.EligibilityMonths, value: '6' },
  { key: ConfigKey.PaymentDeadlineDay, value: '5' },
  { key: ConfigKey.PenaltyType, value: 'Fixed' },
  { key: ConfigKey.PenaltyValue, value: '0' },
  { key: ConfigKey.MaxLoansPerGuarantor, value: '0' },
  { key: ConfigKey.EmailProvider, value: 'resend' },
  { key: ConfigKey.EmailFromAddress, value: '' },
  { key: ConfigKey.EmailFromName, value: 'Welfare System' },
  { key: ConfigKey.ResendApiKey, value: '' },
  { key: ConfigKey.OutlookHost, value: '' },
  { key: ConfigKey.OutlookPort, value: '587' },
  { key: ConfigKey.OutlookUsername, value: '' },
  { key: ConfigKey.OutlookPassword, value: '' },
  { key: ConfigKey.EmailContributionStatementCron, value: '0 9 1 * *' },
  { key: ConfigKey.EmailLoanScheduleEnabled, value: 'false' },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    @InjectModel(ConfigSetting.name)
    private readonly configModel: Model<ConfigSettingDocument>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  private async seedDefaults(): Promise<void> {
    const count = await this.configModel.countDocuments();
    if (count === 0) {
      const docs = SEED_DEFAULTS.map((s) => ({ ...s, updatedBy: 'system' }));
      await this.configModel.insertMany(docs);
      this.logger.log('Seeded default config settings');
    }
  }

  async getAll(): Promise<ConfigMap> {
    const cached = await this.redis.get(REDIS_KEY);
    if (cached) {
      return JSON.parse(cached) as ConfigMap;
    }

    const settings = await this.configModel.find().lean().exec();
    const map: ConfigMap = {};
    for (const s of settings) {
      map[s.key] = {
        value: s.value,
        updatedBy: s.updatedBy,
        updatedAt: (s as any).updatedAt?.toISOString?.() ?? String((s as any).updatedAt ?? ''),
      };
    }

    await this.redis.set(REDIS_KEY, JSON.stringify(map), 'EX', REDIS_TTL);
    return map;
  }

  async bulkUpdate(
    updates: Record<string, string>,
    actorId: string,
    actorName: string,
    ip?: string,
  ): Promise<ConfigMap> {
    // Validate each key value
    this.validateUpdates(updates);

    // Cross-field validation: LoanMinAmount vs LoanMaxAmount
    const touchesMin = ConfigKey.LoanMinAmount in updates;
    const touchesMax = ConfigKey.LoanMaxAmount in updates;
    if (touchesMin || touchesMax) {
      const current = await this.getAll();
      const resolvedMin = parseFloat(
        touchesMin ? updates[ConfigKey.LoanMinAmount] : (current[ConfigKey.LoanMinAmount]?.value ?? '0'),
      );
      const resolvedMax = parseFloat(
        touchesMax ? updates[ConfigKey.LoanMaxAmount] : (current[ConfigKey.LoanMaxAmount]?.value ?? '0'),
      );
      if (resolvedMin >= resolvedMax) {
        throw new UnprocessableEntityException(
          `LoanMinAmount (${resolvedMin}) must be less than LoanMaxAmount (${resolvedMax})`,
        );
      }
    }

    // Capture before snapshot for audit
    const current = await this.getAll();
    const beforeSnapshot: Record<string, unknown> = {};
    const afterSnapshot: Record<string, unknown> = {};
    for (const key of Object.keys(updates)) {
      beforeSnapshot[key] = current[key]?.value;
      afterSnapshot[key] = updates[key];
    }

    // Persist each changed key
    for (const [key, value] of Object.entries(updates)) {
      await this.configModel.findOneAndUpdate(
        { key },
        { value, updatedBy: actorName },
        { upsert: true, new: true },
      );
    }

    // Invalidate cache
    await this.redis.del(REDIS_KEY);

    // Audit log
    await this.auditService.log(
      actorId,
      actorName,
      AuditAction.ConfigChange,
      AuditEntity.Config,
      'system',
      beforeSnapshot,
      afterSnapshot,
      ip,
    );

    return this.getAll();
  }

  async testEmail(provider: 'resend' | 'outlook365', to: string): Promise<{ success: true }> {
    const config = await this.getAll();

    let transporter: nodemailer.Transporter;
    if (provider === 'resend') {
      transporter = nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: {
          user: 'resend',
          pass: config[ConfigKey.ResendApiKey]?.value ?? '',
        },
      });
    } else {
      transporter = nodemailer.createTransport({
        host: config[ConfigKey.OutlookHost]?.value ?? '',
        port: parseInt(config[ConfigKey.OutlookPort]?.value ?? '587', 10),
        secure: false,
        auth: {
          user: config[ConfigKey.OutlookUsername]?.value ?? '',
          pass: config[ConfigKey.OutlookPassword]?.value ?? '',
        },
      });
    }

    try {
      await transporter.sendMail({
        from: `"${config[ConfigKey.EmailFromName]?.value ?? 'Welfare System'}" <${config[ConfigKey.EmailFromAddress]?.value ?? ''}>`,
        to,
        subject: 'Welfare System — Test Email',
        text: 'This is a test email from the Welfare Management System.',
      });
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(message);
    }
  }

  private validateUpdates(updates: Record<string, string>): void {
    for (const [key, value] of Object.entries(updates)) {
      switch (key as ConfigKey) {
        case ConfigKey.MonthlyContributionAmount:
          if (!(parseFloat(value) > 0))
            throw new UnprocessableEntityException(`MonthlyContributionAmount must be > 0`);
          break;
        case ConfigKey.LoanMinAmount:
          if (!(parseFloat(value) > 0))
            throw new UnprocessableEntityException(`LoanMinAmount must be > 0`);
          break;
        case ConfigKey.LoanMaxAmount:
          if (!(parseFloat(value) > 0))
            throw new UnprocessableEntityException(`LoanMaxAmount must be > 0`);
          break;
        case ConfigKey.LoanMaxTenure:
          if (!(parseInt(value, 10) > 0))
            throw new UnprocessableEntityException(`LoanMaxTenure must be > 0`);
          break;
        case ConfigKey.InterestRateShort:
          if (!(parseFloat(value) > 0))
            throw new UnprocessableEntityException(`InterestRateShort must be > 0`);
          break;
        case ConfigKey.InterestRateLong:
          if (!(parseFloat(value) > 0))
            throw new UnprocessableEntityException(`InterestRateLong must be > 0`);
          break;
        case ConfigKey.EligibilityMonths:
          if (!(parseInt(value, 10) > 0))
            throw new UnprocessableEntityException(`EligibilityMonths must be > 0`);
          break;
        case ConfigKey.PaymentDeadlineDay: {
          const day = parseInt(value, 10);
          if (!(day >= 1 && day <= 28))
            throw new UnprocessableEntityException(`PaymentDeadlineDay must be between 1 and 28`);
          break;
        }
        case ConfigKey.PenaltyType:
          if (value !== 'Fixed' && value !== 'Percentage')
            throw new UnprocessableEntityException(`PenaltyType must be 'Fixed' or 'Percentage'`);
          break;
        case ConfigKey.PenaltyValue:
          if (!(parseFloat(value) >= 0))
            throw new UnprocessableEntityException(`PenaltyValue must be >= 0`);
          break;
        case ConfigKey.MaxLoansPerGuarantor:
          if (!(parseInt(value, 10) >= 0))
            throw new UnprocessableEntityException(`MaxLoansPerGuarantor must be >= 0`);
          break;
        case ConfigKey.EmailProvider:
          if (value !== 'resend' && value !== 'outlook365')
            throw new UnprocessableEntityException(`EmailProvider must be 'resend' or 'outlook365'`);
          break;
        case ConfigKey.EmailFromAddress:
          if (value !== '' && !EMAIL_REGEX.test(value))
            throw new UnprocessableEntityException(`EmailFromAddress must be a valid email or empty string`);
          break;
        case ConfigKey.OutlookPort:
          if (!(parseInt(value, 10) > 0))
            throw new UnprocessableEntityException(`OutlookPort must be > 0`);
          break;
        case ConfigKey.EmailLoanScheduleEnabled:
          if (value !== 'true' && value !== 'false')
            throw new UnprocessableEntityException(`EmailLoanScheduleEnabled must be 'true' or 'false'`);
          break;
        // Keys with no rules: accept any non-undefined string
        default:
          break;
      }
    }
  }
}
