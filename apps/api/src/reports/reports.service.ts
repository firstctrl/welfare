import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse as toCsv } from 'json2csv';
import puppeteer from 'puppeteer';
import {
  ContributionStatus,
  LoanRepaymentStatus,
  LoanStatus,
  RepaymentSource,
  StaffStatus,
  IMonthlyContributionReport,
  IArrearRow,
  IGuarantorOffsetRow,
  IActiveLoanRow,
  IOverdueLoanRow,
  IRepaidLoanRow,
  IGuarantorExposureRow,
  IBadDebtRow,
  IExitClearanceRow,
  IDashboardStats,
} from '@welfare/shared';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { Loan, LoanDocument } from '../loans/schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from '../loans/schemas/loan-repayment.schema';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { ImportBatch, ImportBatchDocument } from '../contributions/schemas/import-batch.schema';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    @InjectModel(ImportBatch.name) private readonly batchModel: Model<ImportBatchDocument>,
  ) {}

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
    const match: Record<string, unknown> = { source: RepaymentSource.GuarantorOffset };
    if (fromDate || toDate) {
      const dateFilter: Record<string, unknown> = {};
      if (fromDate) dateFilter.$gte = fromDate;
      if (toDate) dateFilter.$lte = toDate;
      match.paidDate = dateFilter;
    }

    const repayments = await this.repaymentModel.find(match).sort({ paidDate: -1 }).exec();
    if (repayments.length === 0) return [];

    const allIds = [
      ...new Set([
        ...repayments.map(r => r.staffId),
        ...repayments.filter(r => r.guarantorStaffId).map(r => r.guarantorStaffId as string),
      ]),
    ];
    const staffDocs = await this.staffModel.find({ _id: { $in: allIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return repayments.map(r => ({
      guarantorStaffId: r.guarantorStaffId ?? '',
      guarantorName: r.guarantorStaffId ? (staffMap.get(r.guarantorStaffId)?.fullName ?? 'Unknown') : 'Unknown',
      borrowerStaffId: r.staffId,
      borrowerName: staffMap.get(r.staffId)?.fullName ?? 'Unknown',
      loanId: r.loanId,
      instalmentNumber: r.instalmentNumber,
      offsetAmount: r.paidAmount,
      offsetDate: r.paidDate?.toISOString() ?? '',
    }));
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

      const offsetRepayments = await this.repaymentModel
        .find({ guarantorStaffId: gId, source: RepaymentSource.GuarantorOffset })
        .exec();
      const totalOffsetAmount = offsetRepayments.reduce((s, r) => s + r.paidAmount, 0);

      const borrowerIds = [...new Set(offsetRepayments.map(r => r.staffId))];
      const borrowerDocs = await this.staffModel.find({ _id: { $in: borrowerIds } }).exec();
      const borrowerMap = new Map(borrowerDocs.map(s => [s._id.toString(), s]));

      const staff = staffMap.get(gId);
      rows.push({
        guarantorId: gId,
        guarantorName: staff?.fullName ?? 'Unknown',
        guarantorStaffNo: staff?.staffId ?? '',
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        activeLoansCount: gLoans.length,
        totalOffsetAmount: Math.round(totalOffsetAmount * 100) / 100,
        offsetHistory: offsetRepayments.map(r => ({
          loanId: r.loanId,
          borrowerName: borrowerMap.get(r.staffId)?.fullName ?? 'Unknown',
          offsetAmount: r.paidAmount,
          offsetDate: r.paidDate?.toISOString() ?? '',
        })),
      });
    }
    return rows.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  async getBadDebt(): Promise<IBadDebtRow[]> {
    const loans = await this.loanModel.find({ status: LoanStatus.BadDebt }).sort({ settledAt: -1 }).exec();
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
      guarantorOffsetAmount: l.guarantorOffsetAmount ?? 0,
      badDebtAmount: l.badDebtAmount ?? 0,
      settledAt: l.settledAt?.toISOString() ?? '',
    }));
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

      const missedAgg = await this.contribModel
        .aggregate([
          {
            $match: {
              staffId: sid,
              status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] },
              isDebit: { $ne: true },
            },
          },
          { $count: 'count' },
        ])
        .exec();

      const missedContributionsCount = missedAgg[0]?.count ?? 0;
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
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // This month contributions
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

    // Members in arrears this month
    const arrearsAgg = await this.contribModel
      .aggregate([
        {
          $match: {
            month,
            year,
            status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] },
            isDebit: { $ne: true },
          },
        },
        { $group: { _id: '$staffId' } },
        { $count: 'count' },
      ])
      .exec();
    const membersInArrears = arrearsAgg[0]?.count ?? 0;

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

  // ─────────────────────────── EXPORT HELPERS ───────────────────────────

  async generateCsv(data: object[], fields: string[]): Promise<string> {
    return toCsv(data, { fields });
  }

  async generatePdf(
    title: string,
    columns: Array<{ header: string; field: string }>,
    rows: object[],
  ): Promise<Buffer> {
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
  th{background:#1e40af;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px}
  tr:nth-child(even) td{background:#f9fafb}
</style>
</head>
<body>
<h1>${title}</h1>
<div class="meta">Generated: ${new Date().toLocaleString('en-GB')}</div>
<table>
  <thead><tr>${headers}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
}
