import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity } from '@welfare/shared';
import { ContributionRate, ContributionRateDocument } from './schemas/contribution-rate.schema';
import { Contribution, ContributionDocument } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ContributionRatesService implements OnModuleInit {
  constructor(
    @InjectModel(ContributionRate.name) private readonly rateModel: Model<ContributionRateDocument>,
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.rateModel.countDocuments().exec();
    if (count > 0) return;

    const config = await this.configService.getAll() as unknown as Record<string, { value: string }>;
    const amount = parseFloat(config['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? '100');

    const earliest = await this.contributionModel
      .find({ month: { $gte: 1 }, year: { $gte: 2000 } })
      .sort({ year: 1, month: 1 })
      .limit(1)
      .exec();
    const now = new Date();
    const { month, year } = earliest.length > 0
      ? { month: earliest[0].month, year: earliest[0].year }
      : { month: now.getMonth() + 1, year: now.getFullYear() };

    await this.rateModel.create({
      month, year, amount,
      effectiveKey: year * 12 + month,
      createdBy: 'system-migration',
    });
  }

  async getRateFor(month: number, year: number): Promise<number> {
    const targetKey = year * 12 + month;
    const rate = await this.rateModel
      .findOne({ effectiveKey: { $lte: targetKey } })
      .sort({ effectiveKey: -1 })
      .exec();
    if (!rate) {
      throw new BadRequestException(
        `No contribution rate defined for ${month}/${year} — add one in Settings before importing or resolving this period.`,
      );
    }
    return rate.amount;
  }

  async list(): Promise<ContributionRateDocument[]> {
    return this.rateModel.find().sort({ effectiveKey: -1 }).exec();
  }

  async create(
    dto: { month: number; year: number; amount: number },
    actorId: string,
    actorName: string,
  ): Promise<ContributionRateDocument> {
    const existing = await this.rateModel.findOne({ month: dto.month, year: dto.year }).exec();
    if (existing) {
      throw new ConflictException(
        `A rate already exists for ${dto.month}/${dto.year} — delete it first to change it.`,
      );
    }
    const rate = await this.rateModel.create({
      month: dto.month, year: dto.year, amount: dto.amount,
      effectiveKey: dto.year * 12 + dto.month,
      createdBy: actorName,
    });
    this.auditService.log(
      actorId, actorName, AuditAction.Create, AuditEntity.Config, rate._id.toString(),
      undefined, { month: dto.month, year: dto.year, amount: dto.amount },
    );
    return rate;
  }

  async delete(id: string, actorId: string, actorName: string): Promise<void> {
    const count = await this.rateModel.countDocuments().exec();
    if (count <= 1) {
      throw new ConflictException('Cannot delete the only remaining contribution rate — at least one must always be defined.');
    }
    const result = await this.rateModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Contribution rate ${id} not found`);
    this.auditService.log(
      actorId, actorName, AuditAction.Delete, AuditEntity.Config, id,
      result.toObject() as unknown as Record<string, unknown>, undefined,
    );
  }
}
