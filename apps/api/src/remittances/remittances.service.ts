import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigKey, IRemittanceReport, IRemittanceReportRow, PaginatedResult } from '@welfare/shared';
import { Remittance, RemittanceDocument } from './schemas/remittance.schema';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function r2(n: number) { return Math.round(n * 100) / 100; }

export interface CreateRemittanceDto {
  month: number;
  year: number;
  receiptDate: string;
}

@Injectable()
export class RemittancesService {
  constructor(
    @InjectModel(Remittance.name) private readonly remittanceModel: Model<RemittanceDocument>,
    @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
    private readonly configService: SystemConfigService,
  ) {}

  async getGrossForPeriod(month: number, year: number): Promise<number> {
    const res = await this.contribModel
      .aggregate([
        { $match: { month, year, isDebit: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } },
      ])
      .exec();
    return res[0]?.total ?? 0;
  }

  async getGrossPreview(
    month: number,
    year: number,
  ): Promise<{ grossAmount: number; charges: number; netPayable: number }> {
    const config = await this.configService.getAll();
    const chargeRate = parseFloat((config as any)[ConfigKey.RemittanceChargeRate]?.value ?? '3');
    const grossAmount = await this.getGrossForPeriod(month, year);
    const charges = r2(grossAmount * chargeRate / 100);
    const netPayable = r2(grossAmount - charges);
    return { grossAmount, charges, netPayable };
  }

  async create(dto: CreateRemittanceDto, actorId: string): Promise<RemittanceDocument> {
    const existing = await this.remittanceModel.findOne({ month: dto.month, year: dto.year }).exec();
    if (existing) throw new ConflictException(`Remittance for ${dto.month}/${dto.year} already exists`);

    const config = await this.configService.getAll();
    const chargeRate = parseFloat((config as any)[ConfigKey.RemittanceChargeRate]?.value ?? '3');
    const grossAmount = await this.getGrossForPeriod(dto.month, dto.year);
    const charges = r2(grossAmount * chargeRate / 100);
    const netPayable = r2(grossAmount - charges);

    return this.remittanceModel.create({
      month: dto.month,
      year: dto.year,
      grossAmount,
      chargeRate,
      charges,
      netPayable,
      receiptDate: new Date(dto.receiptDate),
      recordedBy: actorId,
    });
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedResult<RemittanceDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.remittanceModel.find().sort({ year: -1, month: -1 }).skip(skip).limit(limit).exec(),
      this.remittanceModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getReport(
    fromMonth: number,
    fromYear: number,
    toMonth: number,
    toYear: number,
  ): Promise<IRemittanceReport> {
    const periods: { month: number; year: number }[] = [];
    let m = fromMonth, y = fromYear;
    while (y < toYear || (y === toYear && m <= toMonth)) {
      periods.push({ month: m, year: y });
      if (++m > 12) { m = 1; y++; }
    }

    const records = await this.remittanceModel
      .find({ $or: periods })
      .sort({ year: 1, month: 1 })
      .exec();

    const rows: IRemittanceReportRow[] = records.map(r => ({
      period: `${MONTHS[r.month - 1]} ${r.year}`,
      receiptDate: r.receiptDate.toLocaleDateString('en-GB'),
      grossAmount: r.grossAmount,
      charges: r.charges,
      netPayable: r.netPayable,
    }));

    return {
      rows,
      totalGross: r2(rows.reduce((s, r) => s + r.grossAmount, 0)),
      totalCharges: r2(rows.reduce((s, r) => s + r.charges, 0)),
      totalNet: r2(rows.reduce((s, r) => s + r.netPayable, 0)),
    };
  }
}
