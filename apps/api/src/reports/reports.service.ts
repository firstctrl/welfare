import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { MINIO_CLIENT } from '../storage/minio.module';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import {
  ContributionStatus,
  LoanRepaymentStatus,
  LoanStatus,
  StaffStatus,
  IMonthlyContributionReport,
  IArrearRow,
  IGuarantorOffsetRow,
  IActiveLoanRow,
  IOverdueLoanRow,
  IRepaidLoanRow,
  IGuarantorExposureRow,
  IBadDebtRow,
  IRecoveryActivityRow,
  IExitClearanceRow,
  IDashboardStats,
  ILoanBorrower,
  ILoanStatement,
  IFundSummaryReport,
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
  IFundSummaryDefaultRow,
  IFundSummaryClaimsBreakdownRow,
  ClaimStatus,
} from '@welfare/shared';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { Loan, LoanDocument } from '../loans/schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from '../loans/schemas/loan-repayment.schema';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { ImportBatch, ImportBatchDocument } from '../contributions/schemas/import-batch.schema';
import { Discount, DiscountDocument } from '../loans/schemas/discount.schema';
import { Claim, ClaimDocument } from '../claims/schemas/claim.schema';

const EXITED_STATUSES: StaffStatus[] = [
  StaffStatus.Resigned,
  StaffStatus.Retired,
  StaffStatus.Dismissed,
  StaffStatus.Deceased,
];

function enumerateMonths(start: Date, end: Date): Array<{ month: number; year: number }> {
  const months: Array<{ month: number; year: number }> = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push({ month: cursor.getMonth() + 1, year: cursor.getFullYear() });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return months;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    @InjectModel(ImportBatch.name) private readonly batchModel: Model<ImportBatchDocument>,
    @InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
    @InjectModel(Claim.name) private readonly claimModel: Model<ClaimDocument>,
    @Optional() @Inject(MINIO_CLIENT) private readonly minioClient?: MinioClient,
  ) {}

  // ─────────────────────────── MISSED-MONTH ELIGIBILITY ───────────────────────────

  /**
   * Per-month missed count across all staff, for a Y/fromMonth..toMonth range.
   * A staff-month only counts as "missed" if it's eligible: on/after the staff's
   * dateOfFirstContribution (falling back to dateOfEmployment), on/before an exited
   * staff's exit month, and not in the future.
   */
  private async computeMissedCounts(
    year: number,
    fromMonth: number,
    toMonth: number,
  ): Promise<Map<string, number>> {
    const [staffDocs, contribs] = await Promise.all([
      this.staffModel
        .find()
        .select('_id dateOfFirstContribution dateOfEmployment status updatedAt')
        .lean()
        .exec(),
      this.contribModel
        .find({ year, month: { $gte: fromMonth, $lte: toMonth }, isDebit: { $ne: true } })
        .select('staffId month')
        .lean()
        .exec(),
    ]);

    const docsByMonth = new Map<number, Set<string>>();
    for (const c of contribs as any[]) {
      const set = docsByMonth.get(c.month) ?? new Set<string>();
      set.add(c.staffId);
      docsByMonth.set(c.month, set);
    }

    const now = new Date();
    const result = new Map<string, number>();
    for (let m = fromMonth; m <= toMonth; m++) {
      const monthStart = new Date(year, m - 1, 1);
      const monthEnd = new Date(year, m, 0, 23, 59, 59);
      if (monthEnd > now) {
        result.set(`${year}-${m}`, 0);
        continue;
      }
      const withDoc = docsByMonth.get(m) ?? new Set<string>();
      let missed = 0;
      for (const s of staffDocs as any[]) {
        const start = s.dateOfFirstContribution ?? s.dateOfEmployment;
        if (!start || new Date(start) > monthEnd) continue;
        if (EXITED_STATUSES.includes(s.status) && s.updatedAt && new Date(s.updatedAt) < monthStart) continue;
        const sid = s._id.toString();
        if (!withDoc.has(sid)) missed++;
      }
      result.set(`${year}-${m}`, missed);
    }
    return result;
  }

  /**
   * Earliest month a staff member actually has a contribution record for.
   * Used as the missed/partial window fallback when dateOfFirstContribution
   * is unset — dateOfEmployment predates fund enrollment for many staff
   * (sometimes by decades) and produces bogus pre-enrollment "missed" months.
   */
  private async getEarliestContributionDate(staffId: string): Promise<Date | undefined> {
    const earliest = await this.contribModel
      .find({ staffId, isDebit: { $ne: true } })
      .sort({ year: 1, month: 1 })
      .limit(1)
      .select('month year')
      .lean()
      .exec();
    if (!earliest.length) return undefined;
    const d = earliest[0] as any;
    return new Date(d.year, d.month - 1, 1);
  }

  /**
   * Missed and Partial month counts for one staff member over [start, end],
   * bounded by their contribution eligibility window (start) and today or their
   * exit date (end), whichever the caller passes in.
   *
   * A month with no contribution doc only counts as missed once it has fully
   * ended — contributions for a month are typically received in the first
   * week of the next month, so the current (still-open) month is never
   * counted as missed just because nothing has posted yet.
   */
  private async getMissedAndPartialCounts(
    staffId: string,
    start: Date | undefined,
    end: Date,
  ): Promise<{ missedCount: number; partialCount: number }> {
    if (!start || start > end) return { missedCount: 0, partialCount: 0 };
    const months = enumerateMonths(start, end);
    if (!months.length) return { missedCount: 0, partialCount: 0 };

    const docs = await this.contribModel
      .find({ staffId, isDebit: { $ne: true }, $or: months.map(m => ({ month: m.month, year: m.year })) })
      .select('month year status')
      .lean()
      .exec();
    const byKey = new Map((docs as any[]).map(d => [`${d.year}-${d.month}`, d.status]));

    const now = new Date();
    let missedCount = 0;
    let partialCount = 0;
    for (const m of months) {
      const status = byKey.get(`${m.year}-${m.month}`);
      if (!status) {
        const monthEnd = new Date(m.year, m.month, 0, 23, 59, 59);
        if (monthEnd > now) continue;
        missedCount++;
      } else if (status === ContributionStatus.Partial) {
        partialCount++;
      }
    }
    return { missedCount, partialCount };
  }

  // ─────────────────────────── CONTRIBUTIONS ───────────────────────────

  async getMonthlyContributions(month: number, year: number): Promise<IMonthlyContributionReport> {
    const rows = await this.contribModel
      .aggregate([
        { $match: { month, year, isDebit: { $ne: true } } },
        {
          $lookup: {
            from: 'staff',
            let: { sid: '$staffId' },
            pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } }],
            as: 'staffDoc',
          },
        },
        { $unwind: { path: '$staffDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            staffId: 1,
            staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
            staffNo: { $ifNull: ['$staffDoc.staffId', ''] },
            expectedAmount: 1,
            paidAmount: 1,
            surplusCarriedForward: 1,
            status: 1,
          },
        },
        { $sort: { staffName: 1 } },
      ])
      .exec();

    const totalExpected = rows.reduce((s, r) => s + (r.expectedAmount ?? 0), 0);
    const totalPaid = rows.reduce((s, r) => s + (r.paidAmount ?? 0), 0);
    const totalSurplus = rows.reduce((s, r) => s + (r.surplusCarriedForward ?? 0), 0);

    return { month, year, rows, totalExpected, totalPaid, totalSurplus };
  }

  async getArrearsReport(
    fromMonth: number,
    fromYear: number,
    toMonth: number,
    toYear: number,
  ): Promise<IArrearRow[]> {
    return this.contribModel
      .aggregate([
        {
          $match: {
            status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] },
            isDebit: { $ne: true },
            $or: [
              { year: { $gt: fromYear } },
              { year: fromYear, month: { $gte: fromMonth } },
            ],
            $and: [
              {
                $or: [
                  { year: { $lt: toYear } },
                  { year: toYear, month: { $lte: toMonth } },
                ],
              },
            ],
          },
        },
        {
          $lookup: {
            from: 'staff',
            let: { sid: '$staffId' },
            pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } }],
            as: 'staffDoc',
          },
        },
        { $unwind: { path: '$staffDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            staffId: 1,
            staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
            staffNo: { $ifNull: ['$staffDoc.staffId', ''] },
            month: 1,
            year: 1,
            expectedAmount: 1,
            paidAmount: 1,
            shortfall: { $subtract: ['$expectedAmount', '$paidAmount'] },
            status: 1,
          },
        },
        { $sort: { year: 1, month: 1, staffName: 1 } },
      ])
      .exec();
  }

  async getGuarantorOffsets(fromDate?: Date, toDate?: Date): Promise<IGuarantorOffsetRow[]> {
    const match: Record<string, unknown> = { isDebit: true, source: 'GuarantorOffset' };
    if (fromDate || toDate) {
      const dateFilter: Record<string, unknown> = {};
      if (fromDate) dateFilter.$gte = fromDate;
      if (toDate) dateFilter.$lte = toDate;
      match.createdAt = dateFilter;
    }

    const debits = await this.contribModel.find(match).sort({ createdAt: -1 }).exec();
    if (debits.length === 0) return [];

    const allIds = [
      ...new Set([
        ...debits.map(d => d.staffId),
        ...debits.filter(d => d.borrowerStaffId).map(d => d.borrowerStaffId as string),
      ]),
    ];
    const staffDocs = await this.staffModel.find({ _id: { $in: allIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return debits.map(d => {
      const createdAt = (d as unknown as { createdAt?: Date }).createdAt;
      return {
        guarantorStaffId: d.staffId,
        guarantorName: staffMap.get(d.staffId)?.fullName ?? 'Unknown',
        borrowerStaffId: d.borrowerStaffId ?? '',
        borrowerName: d.borrowerStaffId ? (staffMap.get(d.borrowerStaffId)?.fullName ?? 'Unknown') : 'Unknown',
        loanId: d.loanId ?? '',
        instalmentNumber: d.instalmentNumber ?? 0,
        offsetAmount: d.paidAmount,
        offsetDate: createdAt ? createdAt.toISOString() : '',
      };
    });
  }

  // ─────────────────────────── LOANS ───────────────────────────

  async getActiveLoans(): Promise<IActiveLoanRow[]> {
    const loans = await this.loanModel.find({ status: LoanStatus.Active }).sort({ disbursedDate: -1 }).exec();
    if (loans.length === 0) return [];

    const staffIds = [...new Set([...loans.map(l => l.staffId), ...loans.map(l => l.guarantorId)])];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    const rows: IActiveLoanRow[] = [];
    for (const loan of loans) {
      const repayments = await this.repaymentModel
        .find({
          loanId: loan._id.toString(),
          status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
        })
        .exec();

      const outstandingBalance = repayments.reduce((s, r) => s + (r.dueAmount - r.paidAmount), 0);
      const next = [...repayments]
        .filter(r => r.status !== LoanRepaymentStatus.Overdue)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

      rows.push({
        loanId: loan._id.toString(),
        staffId: loan.staffId,
        staffName: staffMap.get(loan.staffId)?.fullName ?? 'Unknown',
        staffNo: staffMap.get(loan.staffId)?.staffId ?? '',
        guarantorId: loan.guarantorId,
        guarantorName: staffMap.get(loan.guarantorId)?.fullName ?? 'Unknown',
        principalAmount: loan.principalAmount,
        outstandingBalance: Math.round(outstandingBalance * 100) / 100,
        nextDueDate: next ? next.dueDate.toISOString() : null,
        nextDueAmount: next ? next.dueAmount - next.paidAmount : null,
        disbursedDate: loan.disbursedDate.toISOString(),
      });
    }
    return rows;
  }

  async getOverdueLoans(): Promise<IOverdueLoanRow[]> {
    const now = new Date();
    const repayments = await this.repaymentModel
      .find({ status: LoanRepaymentStatus.Overdue })
      .sort({ dueDate: 1 })
      .exec();
    if (repayments.length === 0) return [];

    const staffIds = [...new Set(repayments.map(r => r.staffId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return repayments.map(r => ({
      loanId: r.loanId,
      staffId: r.staffId,
      staffName: staffMap.get(r.staffId)?.fullName ?? 'Unknown',
      instalmentNumber: r.instalmentNumber,
      dueDate: r.dueDate.toISOString(),
      dueAmount: r.dueAmount,
      paidAmount: r.paidAmount,
      penaltyAmount: r.penaltyAmount,
      daysOverdue: Math.floor((now.getTime() - r.dueDate.getTime()) / (1000 * 60 * 60 * 24)),
      status: r.status,
    }));
  }

  async getRepaidLoans(): Promise<IRepaidLoanRow[]> {
    const loans = await this.loanModel
      .find({ status: { $in: [LoanStatus.Completed, LoanStatus.WrittenOff] } })
      .sort({ settledAt: -1 })
      .exec();
    if (loans.length === 0) return [];

    const staffIds = [...new Set(loans.map(l => l.staffId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return loans.map(l => ({
      loanId: l._id.toString(),
      staffId: l.staffId,
      staffName: staffMap.get(l.staffId)?.fullName ?? 'Unknown',
      principalAmount: l.principalAmount,
      totalRepayable: l.totalRepayable,
      settledAt: l.settledAt?.toISOString() ?? '',
      disbursedDate: l.disbursedDate.toISOString(),
      tenureMonths: l.tenureMonths,
    }));
  }

  async getGuarantorExposure(): Promise<IGuarantorExposureRow[]> {
    const activeLoans = await this.loanModel.find({ status: LoanStatus.Active }).exec();
    if (activeLoans.length === 0) return [];

    const guarantorIds = [...new Set(activeLoans.map(l => l.guarantorId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: guarantorIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    const rows: IGuarantorExposureRow[] = [];
    for (const gId of guarantorIds) {
      const gLoans = activeLoans.filter(l => l.guarantorId === gId);
      let totalOutstanding = 0;

      for (const loan of gLoans) {
        const pending = await this.repaymentModel
          .find({
            loanId: loan._id.toString(),
            status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
          })
          .exec();
        totalOutstanding += pending.reduce((s, r) => s + r.dueAmount - r.paidAmount, 0);
      }

      const offsetDebits = await this.contribModel
        .find({ staffId: gId, isDebit: true, source: 'GuarantorOffset' })
        .exec();
      const totalOffsetAmount = offsetDebits.reduce((s, d) => s + d.paidAmount, 0);

      const borrowerIds = [...new Set(offsetDebits.map(d => d.borrowerStaffId).filter(Boolean) as string[])];
      const borrowerDocs = borrowerIds.length
        ? await this.staffModel.find({ _id: { $in: borrowerIds } }).exec()
        : [];
      const borrowerMap = new Map(borrowerDocs.map(s => [s._id.toString(), s]));

      const staff = staffMap.get(gId);
      rows.push({
        guarantorId: gId,
        guarantorName: staff?.fullName ?? 'Unknown',
        guarantorStaffNo: staff?.staffId ?? '',
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        activeLoansCount: gLoans.length,
        totalOffsetAmount: Math.round(totalOffsetAmount * 100) / 100,
        offsetHistory: offsetDebits.map(d => {
          const createdAt = (d as unknown as { createdAt?: Date }).createdAt;
          return {
            loanId: d.loanId ?? '',
            borrowerName: d.borrowerStaffId ? (borrowerMap.get(d.borrowerStaffId)?.fullName ?? 'Unknown') : 'Unknown',
            offsetAmount: d.paidAmount,
            offsetDate: createdAt ? createdAt.toISOString() : '',
          };
        }),
      });
    }
    return rows.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  async getBadDebt(): Promise<IBadDebtRow[]> {
    // Two sources of bad debt: loans settled BadDebt via exit-settlement, and
    // Defaulted loans still carrying an unrecovered badDebtAmount from the
    // end-of-tenure recovery job (that job never flips status away from
    // Defaulted, so those loans wouldn't otherwise show up here).
    const loans = await this.loanModel.find({
      $or: [
        { status: LoanStatus.BadDebt },
        {
          status: LoanStatus.Defaulted,
          $expr: { $gt: ['$badDebtAmount', { $ifNull: ['$badDebtRecovered', 0] }] },
        },
      ],
    }).sort({ settledAt: -1, defaultedAt: -1 }).exec();
    if (loans.length === 0) return [];

    const staffIds = [...new Set(loans.map(l => l.staffId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return loans.map(l => ({
      loanId: l._id.toString(),
      staffId: l.staffId,
      staffName: staffMap.get(l.staffId)?.fullName ?? 'Unknown',
      principalAmount: l.principalAmount,
      totalRepayable: l.totalRepayable,
      exitDeductionAmount: l.exitDeductionAmount ?? 0,
      // guarantorOffsetAmount is only set by the exit-settlement flow;
      // guarantorRestitutionOwed is the end-of-tenure recovery job's equivalent
      // (per-instalment overdue offsets + the lump-sum recovery debit). A given
      // loan realistically only has one path populated, but sum both so this
      // column reflects total guarantor exposure regardless of which path a
      // loan took.
      guarantorOffsetAmount: Math.round(((l.guarantorOffsetAmount ?? 0) + (l.guarantorRestitutionOwed ?? 0)) * 100) / 100,
      badDebtAmount: l.badDebtAmount ?? 0,
      badDebtRecovered: l.badDebtRecovered ?? 0,
      outstandingBadDebt: Math.round(((l.badDebtAmount ?? 0) - (l.badDebtRecovered ?? 0)) * 100) / 100,
      status: l.status,
      eventDate: (l.settledAt ?? l.defaultedAt)?.toISOString() ?? '',
    }));
  }

  async getRecoveryActivity(): Promise<IRecoveryActivityRow[]> {
    const rows = await this.contribModel.find({
      source: { $in: ['DefaulterRestitution', 'BadDebtRecovery'] },
    }).sort({ createdAt: -1 }).exec();
    if (rows.length === 0) return [];

    const staffIds = [
      ...new Set([
        ...rows.map(r => r.staffId),
        ...rows.filter(r => r.borrowerStaffId).map(r => r.borrowerStaffId as string),
      ]),
    ];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return rows.map(r => {
      const createdAt = (r as unknown as { createdAt?: Date }).createdAt;
      return {
        id: r._id.toString(),
        date: createdAt ? createdAt.toISOString() : '',
        kind: r.source === 'BadDebtRecovery' ? 'BadDebtRecovery' : 'GuarantorRestitution',
        direction: r.isDebit ? 'Debit' : 'Credit',
        staffId: r.staffId,
        staffName: staffMap.get(r.staffId)?.fullName ?? 'Unknown',
        loanId: r.loanId ?? '',
        borrowerStaffId: r.borrowerStaffId,
        borrowerName: r.borrowerStaffId ? (staffMap.get(r.borrowerStaffId)?.fullName ?? 'Unknown') : undefined,
        amount: r.paidAmount,
      };
    });
  }

  // ─────────────────────────── LOAN STATEMENT ───────────────────────────

  async getLoanBorrowers(): Promise<ILoanBorrower[]> {
    const staffIds = await this.loanModel.distinct('staffId');
    if (staffIds.length === 0) return [];

    const staffDocs = await this.staffModel
      .find({ _id: { $in: staffIds } })
      .select('_id fullName staffId')
      .lean()
      .exec();

    return (staffDocs as Array<{ _id: { toString(): string }; fullName: string; staffId: string }>)
      .map(s => ({ staffId: s._id.toString(), staffNo: s.staffId, displayName: s.fullName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async getLoanStatement(staffId: string, loanId: string): Promise<ILoanStatement> {
    const loan = await this.loanModel.findById(loanId).exec();
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.staffId !== staffId) throw new BadRequestException('Loan does not belong to this staff member');

    const [staffDoc, guarantorDocs] = await Promise.all([
      this.staffModel.findById(staffId).exec(),
      this.staffModel.find({ _id: { $in: [loan.guarantorId] } }).exec(),
    ]);

    const guarantor = guarantorDocs[0];
    const repayments = await this.repaymentModel
      .find({ loanId })
      .sort({ instalmentNumber: 1 })
      .exec();

    const totalPaid = repayments.reduce((s, r) => s + r.paidAmount, 0);
    const outstanding = Math.max(0, Math.round((loan.totalRepayable - totalPaid) * 100) / 100);
    const penaltyPaid = repayments.reduce((s, r) => s + r.penaltyAmount, 0);
    const completionRate = loan.totalRepayable > 0
      ? Math.round((totalPaid / loan.totalRepayable) * 100)
      : 0;

    return {
      staff: {
        staffNo: staffDoc?.staffId ?? '',
        displayName: staffDoc?.fullName ?? 'Unknown',
        department: (staffDoc as any)?.department ?? '',
      },
      loan: {
        id: loan._id.toString(),
        principalAmount: loan.principalAmount,
        interestRate: loan.interestRate,
        totalRepayable: loan.totalRepayable,
        tenureMonths: loan.tenureMonths,
        disbursedDate: loan.disbursedDate.toISOString(),
        status: loan.status,
        chequeNo: loan.chequeNo,
        pvNo: loan.pvNo,
        guarantor: {
          staffNo: guarantor?.staffId ?? '',
          displayName: guarantor?.fullName ?? 'Unknown',
        },
      },
      kpis: {
        totalPaid: Math.round(totalPaid * 100) / 100,
        outstanding,
        penaltyPaid: Math.round(penaltyPaid * 100) / 100,
        completionRate,
      },
      instalments: repayments.map(r => ({
        instalmentNumber: r.instalmentNumber,
        dueDate: r.dueDate.toISOString(),
        dueAmount: r.dueAmount,
        principalAmount: r.principalAmount ?? 0,
        interestAmount: r.interestAmount ?? 0,
        paidAmount: r.paidAmount,
        penaltyAmount: r.penaltyAmount,
        paidDate: r.paidDate?.toISOString(),
        status: r.status,
        source: r.source,
      })),
    };
  }

  async generateLoanStatementPdf(staffId: string, loanId: string): Promise<Buffer> {
    const stmt = await this.getLoanStatement(staffId, loanId);
    const fmt = (n: number) =>
      `GHS ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const logoPath = path.join(__dirname, 'assets', 'ncc-logo.png');
    const logoBase64 = fs.existsSync(logoPath)
      ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
      : '';

    const statusBg: Record<string, string> = {
      Paid: '#dcfce7',
      Partial: '#fef9c3',
      Overdue: '#fee2e2',
      Pending: '#f1f5f9',
      Waived: '#f1f5f9',
    };

    const instalmentRows = stmt.instalments
      .map(
        (r) => `
        <tr>
          <td>${r.instalmentNumber}</td>
          <td>${new Date(r.dueDate).toLocaleDateString('en-GB')}</td>
          <td style="text-align:right">${fmt(r.dueAmount)}</td>
          <td style="text-align:right">${fmt(r.principalAmount)}</td>
          <td style="text-align:right">${fmt(r.interestAmount)}</td>
          <td style="text-align:right">${fmt(r.paidAmount)}</td>
          <td style="text-align:right">${r.penaltyAmount > 0 ? fmt(r.penaltyAmount) : '-'}</td>
          <td>${r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-GB') : '-'}</td>
          <td style="background:${statusBg[r.status] ?? '#fff'};font-weight:bold;font-size:10px">${r.status}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:20px;color:#111}
  .header{display:flex;justify-content:flex-start;align-items:center;gap:16px;margin-bottom:16px;border-bottom:2px solid #bc4680;padding-bottom:10px}
  .org{font-size:18px;font-weight:bold;color:#bc4680}
  .title{font-size:13px;font-weight:bold;margin-top:4px}
  .meta{color:#666;font-size:10px;margin-top:2px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;font-size:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px}
  .info-row{display:flex;gap:6px}
  .info-label{color:#64748b;min-width:90px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
  .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px}
  .kpi-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .kpi-value{font-size:14px;font-weight:bold;color:#1e293b;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#bc4680;color:#fff;padding:5px 6px;text-align:left;white-space:nowrap;font-size:10px}
  th:not(:first-child){text-align:right}
  th:last-child, th:nth-child(8){text-align:left}
  td{padding:4px 6px;border:1px solid #e5e7eb;white-space:nowrap}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;background-image:url('${logoBase64}');background-size:contain;background-repeat:no-repeat;background-position:center;opacity:0.05;z-index:0;pointer-events:none}
  .logo-img{height:52px;width:auto;object-fit:contain}
</style>
</head>
<body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<div class="header">
  ${logoBase64 ? `<img class="logo-img" src="${logoBase64}" alt="logo"/>` : ''}
  <div>
    <div class="org">Welfare Department</div>
    <div class="title">Loan Statement: ${stmt.staff.displayName}</div>
    <div class="meta">Staff ID: ${stmt.staff.staffNo} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString('en-GB')}</div>
  </div>
</div>
<div class="info-grid">
  <div class="info-row"><span class="info-label">Principal:</span><span>${fmt(stmt.loan.principalAmount)}</span></div>
  <div class="info-row"><span class="info-label">Total Repayable:</span><span>${fmt(stmt.loan.totalRepayable)}</span></div>
  <div class="info-row"><span class="info-label">Interest Rate:</span><span>${stmt.loan.interestRate}%</span></div>
  <div class="info-row"><span class="info-label">Tenure:</span><span>${stmt.loan.tenureMonths} months</span></div>
  <div class="info-row"><span class="info-label">Disbursed:</span><span>${new Date(stmt.loan.disbursedDate).toLocaleDateString('en-GB')}</span></div>
  <div class="info-row"><span class="info-label">Loan Status:</span><span style="font-weight:bold">${stmt.loan.status}</span></div>
  <div class="info-row"><span class="info-label">Guarantor:</span><span>${stmt.loan.guarantor.displayName} (${stmt.loan.guarantor.staffNo})</span></div>
  <div class="info-row"><span class="info-label">Cheque:</span><span>${stmt.loan.chequeNo ?? '-'}</span></div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kpi-label">Amount Paid</div><div class="kpi-value">${fmt(stmt.kpis.totalPaid)}</div></div>
  <div class="kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">${fmt(stmt.kpis.outstanding)}</div></div>
  <div class="kpi"><div class="kpi-label">Penalty Paid</div><div class="kpi-value">${fmt(stmt.kpis.penaltyPaid)}</div></div>
  <div class="kpi"><div class="kpi-label">Completion</div><div class="kpi-value">${stmt.kpis.completionRate}%</div></div>
</div>
<table>
  <thead>
    <tr>
      <th>#</th><th>Due Date</th><th>Due (GHS)</th><th>Principal</th><th>Interest</th>
      <th>Paid (GHS)</th><th>Penalty</th><th>Paid Date</th><th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${instalmentRows || '<tr><td colspan="9" style="text-align:center;padding:20px;color:#999">No instalment records found</td></tr>'}
  </tbody>
</table>
</body></html>`;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const confidentialBand = `
        <div style="width:100%;font-size:8px;font-family:Arial,sans-serif;color:#b91c1c;
                    text-align:center;font-weight:bold;letter-spacing:4px;padding:3px 0;">
          CONFIDENTIAL
        </div>`;
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: confidentialBand,
        footerTemplate: confidentialBand,
        margin: { top: '16mm', right: '10mm', bottom: '16mm', left: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ─────────────────────────── STAFF ───────────────────────────

  async getExitClearanceReport(): Promise<IExitClearanceRow[]> {
    const exitedStaff = await this.staffModel
      .find({
        status: { $in: [StaffStatus.Resigned, StaffStatus.Dismissed, StaffStatus.Deceased, StaffStatus.Retired] },
      })
      .exec();
    if (exitedStaff.length === 0) return [];

    const rows: IExitClearanceRow[] = [];
    for (const staff of exitedStaff) {
      const sid = staff._id.toString();

      const activeLoans = await this.loanModel.find({ staffId: sid, status: LoanStatus.Active }).exec();
      let outstandingLoanBalance = 0;
      for (const loan of activeLoans) {
        const pending = await this.repaymentModel
          .find({
            loanId: loan._id.toString(),
            status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
          })
          .exec();
        outstandingLoanBalance += pending.reduce((s, r) => s + r.dueAmount - r.paidAmount, 0);
      }

      const start = (staff as any).dateOfFirstContribution ?? (await this.getEarliestContributionDate(sid));
      const now = new Date();
      const end = (staff as any).updatedAt && (staff as any).updatedAt < now ? (staff as any).updatedAt : now;
      const { missedCount, partialCount } = await this.getMissedAndPartialCounts(sid, start, end);
      const missedContributionsCount = missedCount + partialCount;
      const outstandingRounded = Math.round(outstandingLoanBalance * 100) / 100;

      if (outstandingRounded > 0 || missedContributionsCount > 0) {
        rows.push({
          staffId: sid,
          staffName: staff.fullName,
          staffNo: staff.staffId,
          status: staff.status,
          outstandingLoanBalance: outstandingRounded,
          missedContributionsCount,
          activeLoanIds: activeLoans.map(l => l._id.toString()),
        });
      }
    }
    return rows;
  }

  // ─────────────────────────── DASHBOARD ───────────────────────────

  async getDashboardStats(): Promise<IDashboardStats> {
    const now = new Date();
    // Contributions for month N are received in month N+1, so show previous month's collection
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = prevDate.getMonth() + 1;
    const year = prevDate.getFullYear();

    // Previous month contributions
    const contribAgg = await this.contribModel
      .aggregate([
        { $match: { month, year, isDebit: { $ne: true } } },
        { $group: { _id: null, collected: { $sum: '$paidAmount' }, expected: { $sum: '$expectedAmount' } } },
      ])
      .exec();
    const collected = contribAgg[0]?.collected ?? 0;
    const expected = contribAgg[0]?.expected ?? 0;
    const collectionRate = expected > 0 ? Math.round((collected / expected) * 100) : 0;

    // Loan status distribution
    const loanStatusAgg = await this.loanModel
      .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      .exec();
    const loanStatusDistribution = loanStatusAgg.map(a => ({ status: a._id, count: a.count }));
    const activeCount = loanStatusDistribution.find(d => d.status === LoanStatus.Active)?.count ?? 0;

    // Total outstanding
    const outstandingAgg = await this.repaymentModel
      .aggregate([
        {
          $match: {
            status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
          },
        },
        { $group: { _id: null, total: { $sum: { $subtract: ['$dueAmount', '$paidAmount'] } } } },
      ])
      .exec();
    const totalOutstanding = Math.round((outstandingAgg[0]?.total ?? 0) * 100) / 100;

    // Overdue count
    const overdueInstalments = await this.repaymentModel
      .find({ status: LoanRepaymentStatus.Overdue })
      .exec();

    // Members in arrears this month: eligible staff with no contribution doc, plus Partial docs
    const missedThisMonth = (await this.computeMissedCounts(year, month, month)).get(`${year}-${month}`) ?? 0;
    const partialAgg = await this.contribModel
      .aggregate([
        { $match: { month, year, status: ContributionStatus.Partial, isDebit: { $ne: true } } },
        { $group: { _id: '$staffId' } },
        { $count: 'count' },
      ])
      .exec();
    const membersInArrears = missedThisMonth + (partialAgg[0]?.count ?? 0);

    // Monthly trend (last 12 months)
    const months: Array<{ year: number; month: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyTrend = await Promise.all(
      months.map(async ({ year: y, month: m }) => {
        const agg = await this.contribModel
          .aggregate([
            { $match: { year: y, month: m, isDebit: { $ne: true } } },
            { $group: { _id: null, collected: { $sum: '$paidAmount' }, expected: { $sum: '$expectedAmount' } } },
          ])
          .exec();
        return {
          year: y,
          month: m,
          label: `${MONTH_NAMES[m - 1]} ${y}`,
          collected: agg[0]?.collected ?? 0,
          expected: agg[0]?.expected ?? 0,
        };
      }),
    );

    // Upcoming payments (next 7 days)
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const upcoming = await this.repaymentModel
      .find({
        dueDate: { $gte: now, $lte: weekFromNow },
        status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] },
      })
      .sort({ dueDate: 1 })
      .limit(5)
      .exec();

    const upcomingStaffIds = [...new Set(upcoming.map(r => r.staffId))];
    const upcomingStaff = await this.staffModel.find({ _id: { $in: upcomingStaffIds } }).exec();
    const upStaffMap = new Map(upcomingStaff.map(s => [s._id.toString(), s]));
    const upcomingPayments = upcoming.map(r => ({
      loanId: r.loanId,
      staffName: upStaffMap.get(r.staffId)?.fullName ?? 'Unknown',
      dueDate: r.dueDate.toISOString(),
      dueAmount: r.dueAmount - r.paidAmount,
      instalmentNumber: r.instalmentNumber,
    }));

    // Recent flagged batches
    const flaggedBatches = await this.batchModel
      .find({ flaggedRows: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();
    const recentFlaggedBatches = flaggedBatches.map(b => ({
      batchId: b._id.toString(),
      month: b.month,
      year: b.year,
      flaggedRows: b.flaggedRows,
      fileName: b.fileName,
      uploadedAt: (b as any).createdAt?.toISOString() ?? '',
    }));

    return {
      thisMonth: { year, month, collected, expected, collectionRate },
      loans: { activeCount, totalOutstanding },
      overdueInstalments: overdueInstalments.length,
      membersInArrears,
      monthlyTrend,
      loanStatusDistribution,
      upcomingPayments,
      recentFlaggedBatches,
    };
  }

  // ─────────────────────────── STAFF STATEMENT ───────────────────────────

  async getStaffContributionStatement(staffMongoId: string): Promise<{
    staff: { _id: string; fullName: string; staffId: string; email?: string };
    kpis: { totalPaid: number; totalExpected: number; missedMonths: number; totalSurplus: number; collectionRate: number; totalOffsets: number; totalClaims: number };
    years: number[];
    rows: Array<{
      year: number;
      cells: Record<number, { paidAmount: number; expectedAmount: number; status: string } | null>;
      offsetCells: Record<number, { totalAmount: number; items: Array<{ kind?: 'Guarantor' | 'Defaulter'; borrowerName: string; borrowerStaffNo: string; loanId: string; amount: number }> } | null>;
      yearTotal: number;
      yearOffsetTotal: number;
    }>;
    claimYears: Array<{ year: number; claims: Array<{ claimType: string; amount: number }> }>;
  }> {
    const staff = await this.staffModel.findById(staffMongoId).exec();
    if (!staff) throw new Error(`Staff ${staffMongoId} not found`);

    const contribs = await this.contribModel
      .find({ staffId: staffMongoId, isDebit: { $ne: true } })
      .sort({ year: 1, month: 1 })
      .exec();

    // Loan-related deductions stored as debit contributions:
    //  - GuarantorOffset: deducted to settle a loan THIS staff guaranteed
    //  - DefaulterDeduction: deducted to cover THIS staff's own missed instalment
    const offsetDebits = await this.contribModel
      .find({
        staffId: staffMongoId,
        isDebit: true,
        source: { $in: ['GuarantorOffset', 'DefaulterDeduction'] },
      })
      .exec();

    // Look up borrower staff docs for guarantor-offset rows (bulk fetch)
    const borrowerIds = [...new Set(offsetDebits.map(d => d.borrowerStaffId).filter(Boolean) as string[])];
    const borrowerStaff = borrowerIds.length
      ? await this.staffModel.find({ _id: { $in: borrowerIds } }).exec()
      : [];
    const borrowerMap = new Map(borrowerStaff.map(s => [s._id.toString(), s]));

    // Build offset map: yyyy-mm -> { totalAmount, items }
    // For DefaulterDeduction rows, the borrower IS this staff — leave borrowerName blank
    // and tag the item kind so the renderer can distinguish.
    const offsetByKey = new Map<string, { totalAmount: number; items: Array<{ kind: 'Guarantor' | 'Defaulter'; borrowerName: string; borrowerStaffNo: string; loanId: string; amount: number }> }>();
    for (const d of offsetDebits) {
      const key = `${d.year}-${d.month}`;
      const isGuarantor = d.source === 'GuarantorOffset';
      const borrower = isGuarantor && d.borrowerStaffId ? borrowerMap.get(d.borrowerStaffId) : undefined;
      const bucket = offsetByKey.get(key) ?? { totalAmount: 0, items: [] };
      bucket.totalAmount += d.paidAmount;
      bucket.items.push({
        kind: isGuarantor ? 'Guarantor' : 'Defaulter',
        borrowerName: isGuarantor ? (borrower?.fullName ?? 'Unknown') : '',
        borrowerStaffNo: isGuarantor ? (borrower?.staffId ?? '—') : '',
        loanId: d.loanId ?? '—',
        amount: d.paidAmount,
      });
      offsetByKey.set(key, bucket);
    }

    const offsetYears = [...new Set(offsetDebits.map(d => d.year))];
    const years = [...new Set([...contribs.map(c => c.year), ...offsetYears])].sort((a, b) => a - b);
    const byKey = new Map(contribs.map(c => [`${c.year}-${c.month}`, c]));

    const rows = years.map(year => {
      const cells: Record<number, { paidAmount: number; expectedAmount: number; status: string } | null> = {};
      const offsetCells: Record<number, { totalAmount: number; items: Array<{ kind?: 'Guarantor' | 'Defaulter'; borrowerName: string; borrowerStaffNo: string; loanId: string; amount: number }> } | null> = {};
      let yearTotal = 0;
      let yearOffsetTotal = 0;
      for (let m = 1; m <= 12; m++) {
        const c = byKey.get(`${year}-${m}`);
        if (c) {
          cells[m] = { paidAmount: c.paidAmount, expectedAmount: c.expectedAmount, status: c.status };
          yearTotal += c.paidAmount;
        } else {
          cells[m] = null;
        }
        const o = offsetByKey.get(`${year}-${m}`);
        if (o) {
          offsetCells[m] = o;
          yearOffsetTotal += o.totalAmount;
        } else {
          offsetCells[m] = null;
        }
      }
      return { year, cells, offsetCells, yearTotal, yearOffsetTotal };
    });

    const totalPaid = contribs.reduce((s, c) => s + c.paidAmount, 0);
    const totalExpected = contribs.reduce((s, c) => s + c.expectedAmount, 0);
    const totalSurplus = contribs.reduce((s, c) => s + c.surplusCarriedForward, 0);
    const missedStart = (staff as any).dateOfFirstContribution ?? (await this.getEarliestContributionDate(staffMongoId));
    const now = new Date();
    const staffUpdatedAt = (staff as any).updatedAt;
    const missedEnd = EXITED_STATUSES.includes(staff.status) && staffUpdatedAt && staffUpdatedAt < now ? staffUpdatedAt : now;
    const { missedCount, partialCount } = await this.getMissedAndPartialCounts(staffMongoId, missedStart, missedEnd);
    const missedMonths = missedCount + partialCount;
    const collectionRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0;
    const totalOffsets = offsetDebits.reduce((s, d) => s + d.paidAmount, 0);

    const approvedClaims = await this.claimModel
      .find({ staffId: staffMongoId, status: ClaimStatus.Approved })
      .sort({ year: 1 })
      .exec();
    const totalClaims = approvedClaims.reduce((s, c) => s + c.amount, 0);
    const claimsByYear = new Map<number, Array<{ claimType: string; amount: number }>>();
    for (const c of approvedClaims) {
      const bucket = claimsByYear.get(c.year) ?? [];
      bucket.push({ claimType: c.claimType, amount: c.amount });
      claimsByYear.set(c.year, bucket);
    }
    const claimYears = [...claimsByYear.keys()].sort((a, b) => a - b).map((year) => ({
      year,
      claims: claimsByYear.get(year)!,
    }));

    return {
      staff: { _id: staff._id.toString(), fullName: staff.fullName, staffId: staff.staffId, email: staff.email },
      kpis: { totalPaid, totalExpected, missedMonths, totalSurplus, collectionRate, totalOffsets, totalClaims },
      years,
      rows,
      claimYears,
    };
  }

  async generateStatementPdf(staffMongoId: string): Promise<Buffer> {
    const { staff, kpis, rows, claimYears } = await this.getStaffContributionStatement(staffMongoId);
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmt = (n: number) => `GHS ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const logoPath = path.join(__dirname, 'assets', 'ncc-logo.png');
    const logoBase64 = fs.existsSync(logoPath)
      ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
      : '';

    const statusColor: Record<string, string> = {
      Paid: '#dcfce7', Partial: '#fef9c3', Missed: '#fee2e2', CarriedForward: '#dbeafe',
    };

    const headerCells = MONTHS.map(m => `<th>${m}</th>`).join('') + '<th>Total</th>';

    const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const bodyRows = rows.map(row => {
      const cells = Array.from({ length: 12 }, (_, i) => {
        const c = row.cells[i + 1];
        const o = row.offsetCells[i + 1];
        const offsetLine = o && o.totalAmount > 0
          ? `<br/><span style="color:#dc2626;font-size:9px">−${fmt(o.totalAmount)}</span>`
          : '';
        const offsetTitle = o && o.items.length
          ? escapeAttr(o.items.map(it => it.kind === 'Defaulter'
              ? `Own missed instalment: ${fmt(it.amount)}`
              : `Guarantor offset for ${it.borrowerName} (${it.borrowerStaffNo}): ${fmt(it.amount)}`,
            ).join('; '))
          : '';
        if (!c) {
          if (offsetLine) {
            return `<td title="${offsetTitle}">—${offsetLine}</td>`;
          }
          return `<td class="empty">—</td>`;
        }
        const bg = statusColor[c.status] ?? '#fff';
        const title = offsetTitle ? `${c.status} | Deductions: ${offsetTitle}` : c.status;
        return `<td style="background:${bg}" title="${escapeAttr(title)}">${fmt(c.paidAmount)}${offsetLine}</td>`;
      }).join('');
      const yearTotalCell = row.yearOffsetTotal > 0
        ? `<td class="total">${fmt(row.yearTotal)}<br/><span style="color:#dc2626;font-size:9px">−${fmt(row.yearOffsetTotal)}</span></td>`
        : `<td class="total">${fmt(row.yearTotal)}</td>`;
      return `<tr><td class="year-label">${row.year}</td>${cells}${yearTotalCell}</tr>`;
    }).join('');

    // Build offset detail rows (flat list across years)
    const offsetDetailItems: Array<{ paidDate: Date; kind: string; borrowerLabel: string; loanRef: string; amount: number }> = [];
    for (const row of rows) {
      for (let m = 1; m <= 12; m++) {
        const o = row.offsetCells[m];
        if (!o) continue;
        for (const it of o.items) {
          offsetDetailItems.push({
            paidDate: new Date(row.year, m - 1, 1),
            kind: it.kind === 'Defaulter' ? 'Own missed instalment' : 'Guarantor offset',
            borrowerLabel: it.kind === 'Defaulter' ? '—' : `${it.borrowerName} (${it.borrowerStaffNo})`,
            loanRef: it.loanId !== '—' ? it.loanId.slice(-6).toUpperCase() : '—',
            amount: it.amount,
          });
        }
      }
    }
    const offsetDetailHtml = offsetDetailItems.length
      ? `<div style="margin-top:16px"><div style="font-size:11px;font-weight:bold;margin-bottom:6px;color:#1e293b">Loan Deduction Detail</div>
<table>
  <thead><tr><th style="text-align:left">Period</th><th style="text-align:left">Type</th><th style="text-align:left">Borrower</th><th style="text-align:left">Loan Ref</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${offsetDetailItems.map(it => `<tr><td style="text-align:left">${it.paidDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td><td style="text-align:left">${it.kind}</td><td style="text-align:left">${it.borrowerLabel}</td><td style="text-align:left">${it.loanRef}</td><td style="text-align:right;color:#dc2626">−${fmt(it.amount)}</td></tr>`).join('')}</tbody>
</table></div>`
      : '';

    const totalClaimsAmount = claimYears.reduce((s, y) => s + y.claims.reduce((s2, c) => s2 + c.amount, 0), 0);
    const claimsTableHtml = claimYears.length
      ? `<div style="margin-top:16px"><div style="font-size:11px;font-weight:bold;margin-bottom:6px;color:#1e293b">Welfare Claims</div>
<table>
  <thead><tr><th style="text-align:left">Year</th><th style="text-align:left">Claim Type</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${claimYears.map(y => y.claims.map((c, i) => `<tr>${i === 0 ? `<td rowspan="${y.claims.length}" class="year-label">${y.year}</td>` : ''}<td style="text-align:left">${c.claimType}</td><td style="text-align:right">${fmt(c.amount)}</td></tr>`).join('')).join('')}</tbody>
  <tfoot><tr><td colspan="2" style="text-align:right;font-weight:bold">Total Welfare Claims</td><td style="text-align:right;font-weight:bold">${fmt(totalClaimsAmount)}</td></tr></tfoot>
</table></div>`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:20px;color:#111}
  .header{display:flex;justify-content:flex-start;align-items:center;gap:16px;margin-bottom:20px;border-bottom:2px solid #bc4680;padding-bottom:12px}
  .org{font-size:18px;font-weight:bold;color:#bc4680}
  .title{font-size:13px;font-weight:bold;margin-top:4px}
  .meta{color:#666;font-size:10px;margin-top:2px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:16px}
  .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px}
  .kpi-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .kpi-value{font-size:15px;font-weight:bold;color:#1e293b;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#bc4680;color:#fff;padding:5px 6px;text-align:center;white-space:nowrap;font-size:10px}
  th:first-child{text-align:left}
  td{padding:4px 6px;border:1px solid #e5e7eb;text-align:center;white-space:nowrap}
  td.year-label{font-weight:bold;background:#f8fafc;text-align:left}
  td.total{font-weight:bold;background:#eff6ff}
  td.empty{color:#ccc}
  .legend{display:flex;gap:12px;margin-top:10px;font-size:9px}
  .leg-item{display:flex;align-items:center;gap:4px}
  .leg-dot{width:10px;height:10px;border-radius:2px;border:1px solid #ccc}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;background-image:url('${logoBase64}');background-size:contain;background-repeat:no-repeat;background-position:center;opacity:0.05;z-index:0;pointer-events:none}
  .logo-img{height:52px;width:auto;object-fit:contain}
</style>
</head>
<body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<div class="header">
  ${logoBase64 ? `<img class="logo-img" src="${logoBase64}" alt="logo"/>` : ''}
  <div>
    <div class="org">Welfare Department</div>
    <div class="title">Contribution Statement - ${staff.fullName}</div>
    <div class="meta">Staff ID: ${staff.staffId} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString('en-GB')}</div>
  </div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kpi-label">Total Paid</div><div class="kpi-value">${fmt(kpis.totalPaid)}</div></div>
  <div class="kpi"><div class="kpi-label">Total Expected</div><div class="kpi-value">${fmt(kpis.totalExpected)}</div></div>
  <div class="kpi"><div class="kpi-label">Collection Rate</div><div class="kpi-value">${kpis.collectionRate}%</div></div>
  ${kpis.missedMonths > 0 ? `<div class="kpi"><div class="kpi-label">Missed / Partial</div><div class="kpi-value">${kpis.missedMonths} months</div></div>` : ''}
  ${kpis.totalOffsets > 0 ? `<div class="kpi"><div class="kpi-label">Loan Deductions</div><div class="kpi-value" style="color:#dc2626">${fmt(kpis.totalOffsets)}</div></div>` : ''}
  ${kpis.totalClaims > 0 ? `<div class="kpi"><div class="kpi-label">Welfare Claims</div><div class="kpi-value" style="color:#dc2626">${fmt(kpis.totalClaims)}</div></div>` : ''}
</div>
<table>
  <thead><tr><th>Year</th>${headerCells}</tr></thead>
  <tbody>${bodyRows.length ? bodyRows : '<tr><td colspan="14" style="text-align:center;padding:20px;color:#999">No contribution records found</td></tr>'}</tbody>
</table>
<div class="legend">
  <div class="leg-item"><div class="leg-dot" style="background:#dcfce7"></div> Paid</div>
  <div class="leg-item"><div class="leg-dot" style="background:#fef9c3"></div> Partial</div>
  <div class="leg-item"><div class="leg-dot" style="background:#fee2e2"></div> Missed</div>
  <div class="leg-item"><div class="leg-dot" style="background:#dbeafe"></div> Carried Forward</div>
</div>
<div style="margin-top:8px;font-size:9px;color:#6b7280;font-style:italic">Red figures indicate amounts deducted from your contributions: either to settle a loan you guaranteed or to cover your own missed loan instalment.</div>
${offsetDetailHtml}
${claimsTableHtml}
</body></html>`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const confidentialBand = `
        <div style="width:100%;font-size:8px;font-family:Arial,sans-serif;color:#b91c1c;
                    text-align:center;font-weight:bold;letter-spacing:4px;padding:3px 0;">
          CONFIDENTIAL
        </div>`;
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: confidentialBand,
        footerTemplate: confidentialBand,
        margin: { top: '16mm', right: '10mm', bottom: '16mm', left: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ─────────────────────────── EXPORT HELPERS ───────────────────────────

  async generatePdf(
    title: string,
    columns: Array<{ header: string; field: string }>,
    rows: object[],
  ): Promise<Buffer> {
    const logoPath = path.join(__dirname, 'assets', 'ncc-logo.png');
    const logoBase64 = fs.existsSync(logoPath)
      ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
      : '';

    const headers = columns.map(c => `<th>${c.header}</th>`).join('');
    const bodyRows = rows
      .map(row => {
        const cells = columns
          .map(c => `<td>${(row as Record<string, unknown>)[c.field] ?? ''}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:20px}
  h1{font-size:18px;margin-bottom:4px}
  .meta{color:#666;font-size:11px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{background:#bc4680;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px}
  tr:nth-child(even) td{background:#f9fafb}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;background-image:url('${logoBase64}');background-size:contain;background-repeat:no-repeat;background-position:center;opacity:0.05;z-index:0;pointer-events:none}
  .pdf-header{display:flex;justify-content:flex-start;align-items:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #bc4680;padding-bottom:10px}
  .logo-img{height:52px;width:auto;object-fit:contain}
</style>
</head>
<body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<div class="pdf-header">
  ${logoBase64 ? `<img class="logo-img" src="${logoBase64}" alt="logo"/>` : ''}
  <h1 style="margin:0">${title}</h1>
</div>
<div class="meta">Generated: ${new Date().toLocaleString('en-GB')}</div>
<table>
  <thead><tr>${headers}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ─────────────────────────── STAFF RECORD PDF ───────────────────────────

  async generateStaffRecordPdf(staffMongoId: string): Promise<Buffer> {
    const staff = await this.staffModel.findById(staffMongoId).exec();
    if (!staff) throw new NotFoundException(`Staff ${staffMongoId} not found`);

    const fmt = (n: number) =>
      `GHS ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtDate = (d?: Date | string | null) =>
      d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const escapeHtml = (s: string) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const escapeAttr = (s: string) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Logo + watermark
    const logoPath = path.join(__dirname, 'assets', 'ncc-logo.png');
    const logoBase64 = fs.existsSync(logoPath)
      ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
      : '';

    // Staff photo (if any)
    let photoBase64 = '';
    if (staff.photoKey && this.minioClient) {
      try {
        const stream = await this.minioClient.getObject('staff-photos', staff.photoKey);
        const chunks: Buffer[] = [];
        for await (const chunk of stream as any) chunks.push(chunk as Buffer);
        const buf = Buffer.concat(chunks);
        const ext = staff.photoKey.split('.').pop()?.toLowerCase() ?? 'jpg';
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        photoBase64 = `data:${mime};base64,${buf.toString('base64')}`;
      } catch (err) {
        this.logger.warn(`Could not load staff photo for PDF: ${(err as Error).message}`);
      }
    }

    // ─── Section 2: contribution cross-tab ───
    const { kpis, rows } = await this.getStaffContributionStatement(staffMongoId);
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const statusColor: Record<string, string> = {
      Paid: '#dcfce7', Partial: '#fef9c3', Missed: '#fee2e2', CarriedForward: '#dbeafe',
    };
    const headerCells = MONTHS.map(m => `<th>${m}</th>`).join('') + '<th>Total</th>';
    const contribBodyRows = rows.map(row => {
      const cells = Array.from({ length: 12 }, (_, i) => {
        const c = row.cells[i + 1];
        const o = row.offsetCells[i + 1];
        const offsetLine = o && o.totalAmount > 0
          ? `<br/><span style="color:#dc2626;font-size:9px">−${fmt(o.totalAmount)}</span>`
          : '';
        const offsetTitle = o && o.items.length
          ? escapeAttr(o.items.map(it => `${it.borrowerName} (${it.borrowerStaffNo}): ${fmt(it.amount)}`).join('; '))
          : '';
        if (!c) {
          if (offsetLine) return `<td title="${offsetTitle}">—${offsetLine}</td>`;
          return `<td class="empty">—</td>`;
        }
        const bg = statusColor[c.status] ?? '#fff';
        const title = offsetTitle ? `${c.status} | Offsets: ${offsetTitle}` : c.status;
        return `<td style="background:${bg}" title="${escapeAttr(title)}">${fmt(c.paidAmount)}${offsetLine}</td>`;
      }).join('');
      const yearTotalCell = row.yearOffsetTotal > 0
        ? `<td class="total">${fmt(row.yearTotal)}<br/><span style="color:#dc2626;font-size:9px">−${fmt(row.yearOffsetTotal)}</span></td>`
        : `<td class="total">${fmt(row.yearTotal)}</td>`;
      return `<tr><td class="year-label">${row.year}</td>${cells}${yearTotalCell}</tr>`;
    }).join('');

    // ─── Section 3: borrowed loans ───
    const borrowedLoans = await this.loanModel.find({ staffId: staffMongoId }).sort({ disbursedDate: -1 }).exec();
    const borrowedIds = borrowedLoans.map(l => l._id.toString());
    const borrowedRepayments = borrowedIds.length
      ? await this.repaymentModel.find({ loanId: { $in: borrowedIds } }).exec()
      : [];
    const borrowedOutstanding = new Map<string, number>();
    for (const r of borrowedRepayments) {
      const cur = borrowedOutstanding.get(r.loanId) ?? 0;
      borrowedOutstanding.set(r.loanId, cur + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount));
    }
    const borrowedRows = borrowedLoans.length
      ? borrowedLoans.map(l => {
          const ref = l._id.toString().slice(-6).toUpperCase();
          const out = Math.round((borrowedOutstanding.get(l._id.toString()) ?? 0) * 100) / 100;
          return `<tr>
            <td style="text-align:left;font-family:monospace">${ref}</td>
            <td>${fmtDate(l.disbursedDate)}</td>
            <td style="text-align:right">${fmt(l.principalAmount)}</td>
            <td style="text-align:right">${fmt(l.totalRepayable)}</td>
            <td>${escapeHtml(l.status)}</td>
            <td style="text-align:right">${fmt(out)}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="6" style="text-align:center;padding:14px;color:#999">No loans on record</td></tr>`;

    // ─── Section 4: guaranteed loans ───
    const guaranteedLoans = await this.loanModel.find({ guarantorId: staffMongoId }).sort({ disbursedDate: -1 }).exec();
    const guaranteedIds = guaranteedLoans.map(l => l._id.toString());
    const guaranteedRepayments = guaranteedIds.length
      ? await this.repaymentModel.find({ loanId: { $in: guaranteedIds } }).exec()
      : [];
    const guaranteedOutstanding = new Map<string, number>();
    for (const r of guaranteedRepayments) {
      const cur = guaranteedOutstanding.get(r.loanId) ?? 0;
      guaranteedOutstanding.set(r.loanId, cur + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount));
    }
    const borrowerIds = [...new Set(guaranteedLoans.map(l => l.staffId))];
    const borrowerDocs = borrowerIds.length
      ? await this.staffModel.find({ _id: { $in: borrowerIds } }).exec()
      : [];
    const borrowerMap = new Map(borrowerDocs.map(s => [s._id.toString(), s]));
    const guaranteedRows = guaranteedLoans.length
      ? guaranteedLoans.map(l => {
          const ref = l._id.toString().slice(-6).toUpperCase();
          const out = Math.round((guaranteedOutstanding.get(l._id.toString()) ?? 0) * 100) / 100;
          const b = borrowerMap.get(l.staffId);
          const borrowerCell = b
            ? `${escapeHtml(b.fullName)} <span style="color:#6b7280;font-size:9px">(${escapeHtml(b.staffId)})</span>`
            : `<span style="color:#999">Unknown</span>`;
          return `<tr>
            <td style="text-align:left">${borrowerCell}</td>
            <td style="text-align:left;font-family:monospace">${ref}</td>
            <td>${fmtDate(l.disbursedDate)}</td>
            <td style="text-align:right">${fmt(l.principalAmount)}</td>
            <td style="text-align:right">${fmt(l.totalRepayable)}</td>
            <td>${escapeHtml(l.status)}</td>
            <td style="text-align:right">${fmt(out)}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="7" style="text-align:center;padding:14px;color:#999">Not guaranteeing any loans</td></tr>`;

    // ─── Section 5: loan deductions (guarantor offsets + own defaulter deductions) ───
    const offsetDebits = await this.contribModel
      .find({
        staffId: staffMongoId,
        isDebit: true,
        source: { $in: ['GuarantorOffset', 'DefaulterDeduction'] },
      })
      .sort({ createdAt: -1 })
      .exec();
    const offsetBorrowerIds = [...new Set(offsetDebits.map(d => d.borrowerStaffId).filter(Boolean) as string[])];
    const offsetBorrowerDocs = offsetBorrowerIds.length
      ? await this.staffModel.find({ _id: { $in: offsetBorrowerIds } }).exec()
      : [];
    const offsetBorrowerMap = new Map(offsetBorrowerDocs.map(s => [s._id.toString(), s]));
    const offsetRows = offsetDebits.length
      ? offsetDebits.map(d => {
          const isGuarantor = d.source === 'GuarantorOffset';
          const b = isGuarantor && d.borrowerStaffId ? offsetBorrowerMap.get(d.borrowerStaffId) : undefined;
          const ref = d.loanId ? d.loanId.slice(-6).toUpperCase() : '—';
          const createdAt = (d as unknown as { createdAt?: Date }).createdAt;
          const typeCell = isGuarantor ? 'Guarantor offset' : 'Own missed instalment';
          const borrowerCell = isGuarantor
            ? (b
                ? `${escapeHtml(b.fullName)} <span style="color:#6b7280;font-size:9px">(${escapeHtml(b.staffId)})</span>`
                : `<span style="color:#999">Unknown</span>`)
            : '—';
          return `<tr>
            <td>${fmtDate(createdAt)}</td>
            <td>${typeCell}</td>
            <td style="text-align:left">${borrowerCell}</td>
            <td style="text-align:left;font-family:monospace">${ref}</td>
            <td>${d.instalmentNumber ?? '—'}</td>
            <td style="text-align:right;color:#dc2626">−${fmt(d.paidAmount)}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="6" style="text-align:center;padding:14px;color:#999">No loan deductions</td></tr>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:20px;color:#111}
  .header{display:flex;justify-content:flex-start;align-items:center;gap:16px;margin-bottom:16px;border-bottom:2px solid #bc4680;padding-bottom:10px}
  .org{font-size:18px;font-weight:bold;color:#bc4680}
  .title{font-size:13px;font-weight:bold;margin-top:4px}
  .meta{color:#666;font-size:10px;margin-top:2px}
  .section-title{font-size:12px;font-weight:bold;color:#1e293b;margin:18px 0 6px 0;padding-bottom:3px;border-bottom:1px solid #e2e8f0}
  .staff-card{display:flex;gap:14px;align-items:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px}
  .staff-photo{width:80px;height:80px;border-radius:6px;object-fit:cover;border:1px solid #cbd5e1;background:#e2e8f0}
  .staff-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;flex:1}
  .staff-field-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
  .staff-field-value{font-size:11px;font-weight:600;color:#1e293b}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#bc4680;color:#fff;padding:5px 6px;text-align:center;white-space:nowrap;font-size:10px}
  th:first-child{text-align:left}
  td{padding:4px 6px;border:1px solid #e5e7eb;text-align:center}
  td.year-label{font-weight:bold;background:#f8fafc;text-align:left}
  td.total{font-weight:bold;background:#eff6ff}
  td.empty{color:#ccc}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;background-image:url('${logoBase64}');background-size:contain;background-repeat:no-repeat;background-position:center;opacity:0.05;z-index:0;pointer-events:none}
  .logo-img{height:52px;width:auto;object-fit:contain}
</style></head>
<body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<div class="header">
  ${logoBase64 ? `<img class="logo-img" src="${logoBase64}" alt="logo"/>` : ''}
  <div>
    <div class="org">Welfare Department</div>
    <div class="title">Staff Record — ${escapeHtml(staff.fullName)}</div>
    <div class="meta">Staff ID: ${escapeHtml(staff.staffId)} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString('en-GB')}</div>
  </div>
</div>

<div class="section-title">Staff Details</div>
<div class="staff-card">
  ${photoBase64 ? `<img class="staff-photo" src="${photoBase64}" alt="photo"/>` : `<div class="staff-photo" style="display:flex;align-items:center;justify-content:center;font-size:9px;color:#94a3b8">No Photo</div>`}
  <div class="staff-fields">
    <div><div class="staff-field-label">Full Name</div><div class="staff-field-value">${escapeHtml(staff.fullName)}</div></div>
    <div><div class="staff-field-label">Staff ID</div><div class="staff-field-value">${escapeHtml(staff.staffId)}</div></div>
    <div><div class="staff-field-label">PF Number</div><div class="staff-field-value">${escapeHtml(staff.pfNo ?? '—')}</div></div>
    <div><div class="staff-field-label">Email</div><div class="staff-field-value">${escapeHtml(staff.email ?? '—')}</div></div>
    <div><div class="staff-field-label">Phone</div><div class="staff-field-value">${escapeHtml(staff.phoneNumber ?? '—')}</div></div>
    <div><div class="staff-field-label">Status</div><div class="staff-field-value">${escapeHtml(staff.status)}</div></div>
    <div><div class="staff-field-label">Date of Employment</div><div class="staff-field-value">${fmtDate(staff.dateOfEmployment)}</div></div>
    <div><div class="staff-field-label">Date of Birth</div><div class="staff-field-value">${fmtDate(staff.dateOfBirth)}</div></div>
    <div><div class="staff-field-label">Level</div><div class="staff-field-value">${escapeHtml(staff.level ?? '—')}</div></div>
  </div>
</div>

<div class="section-title">Contribution History — Total Paid ${fmt(kpis.totalPaid)} / Expected ${fmt(kpis.totalExpected)} (${kpis.collectionRate}%) ${kpis.totalOffsets > 0 ? `<span style="color:#dc2626;font-weight:normal">· Guarantor Offsets ${fmt(kpis.totalOffsets)}</span>` : ''}</div>
<table>
  <thead><tr><th>Year</th>${headerCells}</tr></thead>
  <tbody>${contribBodyRows || `<tr><td colspan="14" style="text-align:center;padding:14px;color:#999">No contributions on record</td></tr>`}</tbody>
</table>

<div class="section-title">Borrowed Loans (${borrowedLoans.length})</div>
<table>
  <thead><tr>
    <th style="text-align:left">Loan Ref</th>
    <th>Disbursed</th>
    <th style="text-align:right">Principal</th>
    <th style="text-align:right">Total Repayable</th>
    <th>Status</th>
    <th style="text-align:right">Outstanding</th>
  </tr></thead>
  <tbody>${borrowedRows}</tbody>
</table>

<div class="section-title">Guaranteed Loans (${guaranteedLoans.length})</div>
<table>
  <thead><tr>
    <th style="text-align:left">Borrower</th>
    <th style="text-align:left">Loan Ref</th>
    <th>Disbursed</th>
    <th style="text-align:right">Principal</th>
    <th style="text-align:right">Total Repayable</th>
    <th>Status</th>
    <th style="text-align:right">Outstanding</th>
  </tr></thead>
  <tbody>${guaranteedRows}</tbody>
</table>

<div class="section-title">Loan Deduction History (${offsetDebits.length})</div>
<table>
  <thead><tr>
    <th>Date</th>
    <th>Type</th>
    <th style="text-align:left">Borrower</th>
    <th style="text-align:left">Loan Ref</th>
    <th>Instalment #</th>
    <th style="text-align:right">Deducted From You</th>
  </tr></thead>
  <tbody>${offsetRows}</tbody>
</table>

</body></html>`;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const confidentialBand = `
        <div style="width:100%;font-size:8px;font-family:Arial,sans-serif;color:#b91c1c;
                    text-align:center;font-weight:bold;letter-spacing:4px;padding:3px 0;">
          CONFIDENTIAL
        </div>`;
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: confidentialBand,
        footerTemplate: confidentialBand,
        margin: { top: '16mm', right: '10mm', bottom: '16mm', left: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  async getFundSummary(year: number, fromMonth: number, toMonth: number): Promise<IFundSummaryReport> {
    const periodStart = new Date(year, fromMonth - 1, 1);
    const periodEnd   = new Date(year, toMonth, 0, 23, 59, 59);

    const [
      contribRows,
      loanGroups,
      recoveryGroups,
      allTimeContribs,
      allTimeLoans,
      activeStaff,
      joiners,
      exits,
      defaultRows,
      allTimeDiscountsAgg,
      periodDiscounts,
      claimGroups,
    ] = await Promise.all([
      // 1. Per-month contribution breakdown
      this.contribModel
        .aggregate([
          { $match: { year, month: { $gte: fromMonth, $lte: toMonth }, isDebit: { $ne: true } } },
          {
            $group: {
              _id: { month: '$month', year: '$year' },
              totalExpected: { $sum: '$expectedAmount' },
              totalCollected: { $sum: '$paidAmount' },
              partialCount: { $sum: { $cond: [{ $eq: ['$status', 'Partial'] }, 1, 0] } },
            },
          },
          { $sort: { '_id.month': 1 } },
        ])
        .exec(),

      // 2. Loan counts/amounts by status (disbursed in period)
      this.loanModel
        .aggregate([
          { $match: { disbursedDate: { $gte: periodStart, $lte: periodEnd } } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalAmount: { $sum: '$principalAmount' },
            },
          },
        ])
        .exec(),

      // 3. Recovery from defaulted/written-off/bad-debt loans disbursed in period
      this.loanModel
        .aggregate([
          {
            $match: {
              disbursedDate: { $gte: periodStart, $lte: periodEnd },
              status: { $in: [LoanStatus.Defaulted, LoanStatus.WrittenOff, LoanStatus.BadDebt] },
            },
          },
          {
            $group: {
              _id: null,
              totalRecovered: {
                $sum: { $add: ['$exitDeductionAmount', '$guarantorOffsetAmount'] },
              },
              totalUnrecovered: { $sum: '$badDebtAmount' },
            },
          },
        ])
        .exec(),

      // 4a. All-time total contributions collected (non-debit)
      this.contribModel
        .aggregate([
          { $match: { isDebit: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),

      // 4b. All-time total loans disbursed
      this.loanModel
        .aggregate([{ $group: { _id: null, total: { $sum: '$principalAmount' } } }])
        .exec(),

      // 5a. Active staff count
      this.staffModel.find({ status: StaffStatus.Active }).select('_id').lean().exec(),

      // 5b. Joiners in period
      this.staffModel
        .find({ createdAt: { $gte: periodStart, $lte: periodEnd } })
        .select('_id')
        .lean()
        .exec(),

      // 5c. Exits in period (non-Active status with updatedAt in period)
      this.staffModel
        .find({
          status: {
            $in: [
              StaffStatus.Resigned,
              StaffStatus.Retired,
              StaffStatus.Dismissed,
              StaffStatus.Deceased,
            ],
          },
          updatedAt: { $gte: periodStart, $lte: periodEnd },
        })
        .select('_id')
        .lean()
        .exec(),

      // 6. Defaulted loan detail rows
      this.loanModel
        .aggregate([
          {
            $match: {
              disbursedDate: { $gte: periodStart, $lte: periodEnd },
              status: { $in: [LoanStatus.Defaulted, LoanStatus.WrittenOff, LoanStatus.BadDebt] },
            },
          },
          {
            $lookup: {
              from: 'staff',
              let: { sid: '$staffId' },
              pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } }],
              as: 'staffDoc',
            },
          },
          { $unwind: { path: '$staffDoc', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              loanId: { $toString: '$_id' },
              staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
              principalAmount: 1,
              totalRecovered: { $add: ['$exitDeductionAmount', '$guarantorOffsetAmount'] },
              badDebtAmount: 1,
              settledAt: 1,
            },
          },
          { $sort: { settledAt: -1 } },
        ])
        .exec(),

      // 7. All-time total discounts
      this.discountModel
        .aggregate([
          { $match: { cancelled: false } },
          { $group: { _id: null, total: { $sum: '$discountAmount' } } },
        ])
        .exec(),

      // 8. Period discount breakdown with staff name
      this.discountModel
        .aggregate([
          {
            $match: {
              cancelled: false,
              dateGranted: { $gte: periodStart, $lte: periodEnd },
            },
          },
          {
            $lookup: {
              from: 'staff',
              let: { sid: '$staffId' },
              pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } }],
              as: 'staffDoc',
            },
          },
          { $unwind: { path: '$staffDoc', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
              loanReference: {
                $substr: ['$loanId', { $subtract: [{ $strLenCP: '$loanId' }, 6] }, 6],
              },
              discountType: 1,
              rate: '$discountRate',
              amount: '$discountAmount',
              dateGranted: 1,
            },
          },
          { $sort: { dateGranted: -1 } },
        ])
        .exec(),

      // 9. Claims breakdown by type (approved claims disbursed in period)
      this.claimModel
        .aggregate([
          { $match: { year, month: { $gte: fromMonth, $lte: toMonth }, status: ClaimStatus.Approved } },
          { $group: { _id: '$claimType', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
        ])
        .exec(),
    ]);

    // ── Contribution summary ──
    const missedCounts = await this.computeMissedCounts(year, fromMonth, toMonth);
    const contributionBreakdown: IFundSummaryContributionBreakdownRow[] = (contribRows as any[]).map(r => ({
      month:          r._id.month,
      year:           r._id.year,
      totalExpected:  r.totalExpected,
      totalCollected: r.totalCollected,
      missedCount:    missedCounts.get(`${r._id.year}-${r._id.month}`) ?? 0,
      partialCount:   r.partialCount,
    }));
    const totalExpected  = contributionBreakdown.reduce((s, r) => s + r.totalExpected, 0);
    const totalCollected = contributionBreakdown.reduce((s, r) => s + r.totalCollected, 0);
    const totalMissed    = contributionBreakdown.reduce((s, r) => s + r.missedCount, 0);
    const totalPartial   = contributionBreakdown.reduce((s, r) => s + r.partialCount, 0);
    const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

    // ── Loan summary ──
    const statusMap = new Map<string, { count: number; totalAmount: number }>(
      (loanGroups as any[]).map(g => [g._id, { count: g.count, totalAmount: g.totalAmount }]),
    );
    const ls = (status: string) => statusMap.get(status) ?? { count: 0, totalAmount: 0 };
    const loanBreakdown: IFundSummaryLoanBreakdownRow[] = (loanGroups as any[]).map(g => ({
      status:      g._id,
      count:       g.count,
      totalAmount: g.totalAmount,
    }));

    // ── Recovery ──
    const rec = (recoveryGroups as any[])[0] ?? { totalRecovered: 0, totalUnrecovered: 0 };
    const totalRecovered   = rec.totalRecovered ?? 0;
    const totalUnrecovered = rec.totalUnrecovered ?? 0;
    const totalDefaultedAmount = totalRecovered + totalUnrecovered;
    const recoveryRate = totalDefaultedAmount > 0 ? Math.round((totalRecovered / totalDefaultedAmount) * 100) : 0;

    // ── Fund balance ──
    const totalContributionsAllTime = (allTimeContribs as any[])[0]?.total ?? 0;
    const totalDisbursedAllTime     = (allTimeLoans as any[])[0]?.total ?? 0;

    // ── Default detail rows ──
    const defaultDetails: IFundSummaryDefaultRow[] = (defaultRows as any[]).map(r => ({
      loanId:          r.loanId,
      staffName:       r.staffName,
      principalAmount: r.principalAmount,
      totalRecovered:  r.totalRecovered ?? 0,
      badDebtAmount:   r.badDebtAmount ?? 0,
      settledAt:       r.settledAt ? new Date(r.settledAt).toISOString() : '',
    }));

    // ── Claims summary ──
    const claimsBreakdown: IFundSummaryClaimsBreakdownRow[] = (claimGroups as any[]).map(g => ({
      claimType: g._id,
      count: g.count,
      totalAmount: g.totalAmount,
    }));
    const totalClaimsAmount = claimsBreakdown.reduce((s, r) => s + r.totalAmount, 0);
    const totalClaimsCount = claimsBreakdown.reduce((s, r) => s + r.count, 0);
    const claimsByType: Record<string, number> = Object.fromEntries(claimsBreakdown.map(r => [r.claimType, r.totalAmount]));

    return {
      period: { year, fromMonth, toMonth },
      contributions: {
        totalExpected,
        totalCollected,
        collectionRate,
        missedCount:  totalMissed,
        partialCount: totalPartial,
      },
      loans: {
        disbursedCount:   (loanGroups as any[]).reduce((s: number, g: any) => s + g.count, 0),
        disbursedAmount:  (loanGroups as any[]).reduce((s: number, g: any) => s + g.totalAmount, 0),
        activeCount:      ls(LoanStatus.Active).count,
        activeAmount:     ls(LoanStatus.Active).totalAmount,
        completedCount:   ls(LoanStatus.Completed).count,
        completedAmount:  ls(LoanStatus.Completed).totalAmount,
        defaultedCount:   ls(LoanStatus.Defaulted).count,
        defaultedAmount:  ls(LoanStatus.Defaulted).totalAmount,
        writtenOffCount:  ls(LoanStatus.WrittenOff).count,
        writtenOffAmount: ls(LoanStatus.WrittenOff).totalAmount,
      },
      recovery: {
        totalRecovered,
        totalUnrecovered,
        recoveryRate,
      },
      fundBalance: {
        totalContributionsAllTime,
        totalDisbursedAllTime,
        netBalance: totalContributionsAllTime - totalDisbursedAllTime,
      },
      membership: {
        activeCount:     (activeStaff as any[]).length,
        joinersInPeriod: (joiners as any[]).length,
        exitsInPeriod:   (exits as any[]).length,
      },
      contributionBreakdown,
      loanBreakdown,
      defaultDetails,
      totalDiscountsGiven: Math.round((allTimeDiscountsAgg[0]?.total ?? 0) * 100) / 100,
      discountBreakdown: periodDiscounts.map((d: any) => ({
        staffName: d.staffName,
        loanReference: String(d.loanReference).toUpperCase(),
        discountType: d.discountType,
        rate: d.rate,
        amount: d.amount,
        dateGranted: d.dateGranted instanceof Date ? d.dateGranted.toISOString() : d.dateGranted,
      })),
      claims: { totalAmount: totalClaimsAmount, count: totalClaimsCount, byType: claimsByType },
      claimsBreakdown,
    };
  }
}
