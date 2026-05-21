import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity, ContributionSource, ContributionStatus, PaginatedResult } from '@welfare/shared';
import { Contribution, ContributionDocument } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionQueryDto } from './dto/contribution-query.dto';

type ConfigMap = Record<string, { value: string }>;

function getPrevMonthYear(month: number, year: number): { month: number; year: number } {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

function getNextMonthYear(month: number, year: number): { month: number; year: number } {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
}

@Injectable()
export class ContributionsService {
  constructor(
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
  ) {}

  calculatePaymentResult(
    existingPaid: number,
    newPayment: number,
    prevSurplus: number,
    expectedAmount: number,
  ): { totalPaid: number; surplusCarriedForward: number; status: ContributionStatus } {
    const totalPaid = existingPaid + newPayment;
    const totalCovered = totalPaid + prevSurplus;
    const status = totalCovered >= expectedAmount ? ContributionStatus.Paid : ContributionStatus.Partial;
    const surplusCarriedForward = Math.max(0, totalCovered - expectedAmount);
    return { totalPaid, surplusCarriedForward, status };
  }

  private async getExpectedAmount(config: ConfigMap): Promise<number> {
    return parseFloat(config['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? '0');
  }

  private async getPrevSurplus(staffId: string, month: number, year: number): Promise<number> {
    const { month: pm, year: py } = getPrevMonthYear(month, year);
    const prev = await this.contributionModel.findOne({ staffId, month: pm, year: py }).exec();
    return prev?.surplusCarriedForward ?? 0;
  }

  async processPayment(
    staffId: string,
    month: number,
    year: number,
    newPayment: number,
    source: ContributionSource,
    actorId: string,
    actorName: string,
    importBatchId?: string,
  ): Promise<ContributionDocument> {
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const expectedAmount = await this.getExpectedAmount(config);
    const existing = await this.contributionModel.findOne({ staffId, month, year }).exec();
    const existingPaid = existing?.paidAmount ?? 0;
    const prevSurplus = await this.getPrevSurplus(staffId, month, year);
    const { totalPaid, surplusCarriedForward, status } = this.calculatePaymentResult(
      existingPaid, newPayment, prevSurplus, expectedAmount,
    );

    const result = await this.contributionModel
      .findOneAndUpdate(
        { staffId, month, year },
        { $set: { expectedAmount, paidAmount: totalPaid, surplusCarriedForward, status, source, recordedBy: actorName, importBatchId } },
        { new: true, upsert: true, runValidators: true },
      )
      .exec();

    if (!result) throw new NotFoundException('Failed to upsert contribution');
    this.auditService.log(
      actorId, actorName, AuditAction.RecordPayment, AuditEntity.Contribution,
      result._id.toString(), existing?.toObject() as unknown as Record<string, unknown>,
      result.toObject() as unknown as Record<string, unknown>,
    );
    return result;
  }

  async processLumpSum(
    staffId: string,
    amount: number,
    startMonth: number,
    startYear: number,
    actorId: string,
    actorName: string,
  ): Promise<ContributionDocument[]> {
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const expectedAmount = await this.getExpectedAmount(config);

    const unpaidMonths = await this.contributionModel
      .find({ staffId, status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] } })
      .sort({ year: 1, month: 1 })
      .exec();

    const monthsToProcess: { month: number; year: number; existingPaid: number }[] =
      unpaidMonths.length > 0
        ? unpaidMonths.map((c) => ({ month: c.month, year: c.year, existingPaid: c.paidAmount }))
        : [{ month: startMonth, year: startYear, existingPaid: 0 }];

    let remaining = amount;
    let prevSurplus = await this.getPrevSurplus(staffId, monthsToProcess[0].month, monthsToProcess[0].year);
    const results: ContributionDocument[] = [];

    for (const target of monthsToProcess) {
      if (remaining <= 0) break;
      const netNeeded = Math.max(0, expectedAmount - prevSurplus);
      const paidThisMonth = Math.min(remaining, netNeeded);
      const { surplusCarriedForward, status } = this.calculatePaymentResult(
        0, paidThisMonth, prevSurplus, expectedAmount,
      );

      const result = await this.contributionModel
        .findOneAndUpdate(
          { staffId, month: target.month, year: target.year },
          { $set: { expectedAmount, paidAmount: paidThisMonth, surplusCarriedForward, status, source: ContributionSource.LumpSum, recordedBy: actorName } },
          { new: true, upsert: true, runValidators: true },
        )
        .exec();

      if (result) {
        results.push(result);
        this.auditService.log(
          actorId, actorName, AuditAction.RecordPayment, AuditEntity.Contribution,
          result._id.toString(), undefined, result.toObject() as unknown as Record<string, unknown>,
        );
      }
      remaining -= paidThisMonth;
      prevSurplus = surplusCarriedForward;
    }
    return results;
  }

  async findAll(query: ContributionQueryDto): Promise<PaginatedResult<any>> {
    const { page = 1, limit = 20, staffId, month, year, status } = query;
    const match: Record<string, unknown> = {};
    if (staffId) match.staffId = staffId;
    if (month) match.month = month;
    if (year) match.year = year;
    if (status) match.status = status;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.contributionModel.aggregate([
        { $match: match },
        { $sort: { year: -1, month: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $addFields: { _staffObjId: { $toObjectId: '$staffId' } } },
        {
          $lookup: {
            from: 'staff',
            localField: '_staffObjId',
            foreignField: '_id',
            as: '_staffArr',
            pipeline: [{ $project: { staffId: 1, fullName: 1 } }],
          },
        },
        {
          $addFields: {
            staffInfo: { $arrayElemAt: ['$_staffArr', 0] },
          },
        },
        { $project: { _staffArr: 0, _staffObjId: 0 } },
      ]).exec(),
      this.contributionModel.countDocuments(match).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async deleteContribution(id: string, actorId: string, actorName: string): Promise<void> {
    const contribution = await this.contributionModel.findById(id).exec();
    if (!contribution) throw new NotFoundException(`Contribution ${id} not found`);
    await this.contributionModel.findByIdAndDelete(id).exec();
    this.auditService.log(
      actorId, actorName, AuditAction.Delete, AuditEntity.Contribution,
      id, contribution.toObject() as unknown as Record<string, unknown>, undefined,
    );
  }

  async findByStaff(staffId: string): Promise<ContributionDocument[]> {
    return this.contributionModel.find({ staffId }).sort({ year: -1, month: -1 }).exec();
  }

  async getSummary(month: number, year: number): Promise<{
    totalExpected: number;
    totalPaid: number;
    totalSurplus: number;
    countPaid: number;
    countPartial: number;
    countMissed: number;
  }> {
    const [agg] = await this.contributionModel.aggregate([
      { $match: { month, year } },
      {
        $group: {
          _id: null,
          totalExpected: { $sum: '$expectedAmount' },
          totalPaid:     { $sum: '$paidAmount' },
          totalSurplus:  { $sum: '$surplusCarriedForward' },
          countPaid:     { $sum: { $cond: [{ $eq: ['$status', ContributionStatus.Paid] }, 1, 0] } },
          countPartial:  { $sum: { $cond: [{ $eq: ['$status', ContributionStatus.Partial] }, 1, 0] } },
          countMissed:   { $sum: { $cond: [{ $eq: ['$status', ContributionStatus.Missed] }, 1, 0] } },
        },
      },
    ]).exec();
    return agg ?? { totalExpected: 0, totalPaid: 0, totalSurplus: 0, countPaid: 0, countPartial: 0, countMissed: 0 };
  }

  async getBalance(staffId: string): Promise<number> {
    const [creditResult, debitResult] = await Promise.all([
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: true } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
    ]);
    const credits = (creditResult as { total: number }[])[0]?.total ?? 0;
    const debits = (debitResult as { total: number }[])[0]?.total ?? 0;
    return credits - debits;
  }

  async debitGuarantorOffset(
    guarantorId: string,
    amount: number,
    _loanId: string,
    _actorId: string,
    actorName: string,
  ): Promise<{ debited: number; remaining: number }> {
    const balance = await this.getBalance(guarantorId);
    const debited = Math.min(amount, Math.max(0, balance));
    const remaining = amount - debited;

    if (debited > 0) {
      const now = new Date();
      await this.contributionModel.create({
        staffId: guarantorId,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        expectedAmount: 0,
        paidAmount: debited,
        surplusCarriedForward: 0,
        isDebit: true,
        status: ContributionStatus.Paid,
        source: ContributionSource.GuarantorOffset,
        recordedBy: actorName,
      });
    }

    return { debited, remaining };
  }
}

// suppress unused import warning for getNextMonthYear (reserved for future penalty calculation)
void getNextMonthYear;

