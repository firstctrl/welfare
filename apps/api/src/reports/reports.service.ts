import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
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
  ILoanBorrower,
  ILoanStatement,
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
    const paidCount = repayments.filter(
      r => r.status === LoanRepaymentStatus.Paid || r.status === LoanRepaymentStatus.Waived,
    ).length;
    const completionRate = loan.tenureMonths > 0
      ? Math.round((paidCount / loan.tenureMonths) * 100)
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
        r => `
        <tr>
          <td>${r.instalmentNumber}</td>
          <td>${new Date(r.dueDate).toLocaleDateString('en-GB')}</td>
          <td style="text-align:right">${fmt(r.dueAmount)}</td>
          <td style="text-align:right">${fmt(r.principalAmount)}</td>
          <td style="text-align:right">${fmt(r.interestAmount)}</td>
          <td style="text-align:right">${fmt(r.paidAmount)}</td>
          <td style="text-align:right">${r.penaltyAmount > 0 ? fmt(r.penaltyAmount) : '—'}</td>
          <td>${r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-GB') : '—'}</td>
          <td style="background:${statusBg[r.status] ?? '#fff'};font-weight:bold;font-size:10px">${r.status}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:20px;color:#111}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;border-bottom:2px solid #bc4680;padding-bottom:10px}
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
</style>
</head>
<body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<div class="header">
  <div>
    <div class="org">NACOC Welfare</div>
    <div class="title">Loan Statement — ${stmt.staff.displayName}</div>
    <div class="meta">Staff No: ${stmt.staff.staffNo} &nbsp;|&nbsp; Dept: ${stmt.staff.department} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString('en-GB')}</div>
  </div>
</div>
<div class="info-grid">
  <div class="info-row"><span class="info-label">Principal:</span><span>${fmt(stmt.loan.principalAmount)}</span></div>
  <div class="info-row"><span class="info-label">Total Repayable:</span><span>${fmt(stmt.loan.totalRepayable)}</span></div>
  <div class="info-row"><span class="info-label">Interest Rate:</span><span>${stmt.loan.interestRate}%</span></div>
  <div class="info-row"><span class="info-label">Tenure:</span><span>${stmt.loan.tenureMonths} months</span></div>
  <div class="info-row"><span class="info-label">Disbursed:</span><span>${new Date(stmt.loan.disbursedDate).toLocaleDateString('en-GB')}</span></div>
  <div class="info-row"><span class="info-label">Status:</span><span style="font-weight:bold">${stmt.loan.status}</span></div>
  <div class="info-row"><span class="info-label">Guarantor:</span><span>${stmt.loan.guarantor.displayName} (${stmt.loan.guarantor.staffNo})</span></div>
  <div class="info-row"><span class="info-label">Cheque / PV:</span><span>${stmt.loan.chequeNo ?? '—'} / ${stmt.loan.pvNo ?? '—'}</span></div>
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

  // ─────────────────────────── STAFF STATEMENT ───────────────────────────

  async getStaffContributionStatement(staffMongoId: string): Promise<{
    staff: { _id: string; fullName: string; staffId: string; email?: string };
    kpis: { totalPaid: number; totalExpected: number; missedMonths: number; totalSurplus: number; collectionRate: number };
    years: number[];
    rows: Array<{ year: number; cells: Record<number, { paidAmount: number; expectedAmount: number; status: string } | null>; yearTotal: number }>;
  }> {
    const staff = await this.staffModel.findById(staffMongoId).exec();
    if (!staff) throw new Error(`Staff ${staffMongoId} not found`);

    const contribs = await this.contribModel
      .find({ staffId: staffMongoId, isDebit: { $ne: true } })
      .sort({ year: 1, month: 1 })
      .exec();

    const years = [...new Set(contribs.map(c => c.year))].sort((a, b) => a - b);
    const byKey = new Map(contribs.map(c => [`${c.year}-${c.month}`, c]));

    const rows = years.map(year => {
      const cells: Record<number, { paidAmount: number; expectedAmount: number; status: string } | null> = {};
      let yearTotal = 0;
      for (let m = 1; m <= 12; m++) {
        const c = byKey.get(`${year}-${m}`);
        if (c) {
          cells[m] = { paidAmount: c.paidAmount, expectedAmount: c.expectedAmount, status: c.status };
          yearTotal += c.paidAmount;
        } else {
          cells[m] = null;
        }
      }
      return { year, cells, yearTotal };
    });

    const totalPaid = contribs.reduce((s, c) => s + c.paidAmount, 0);
    const totalExpected = contribs.reduce((s, c) => s + c.expectedAmount, 0);
    const totalSurplus = contribs.reduce((s, c) => s + c.surplusCarriedForward, 0);
    const missedMonths = contribs.filter(c => c.status === ContributionStatus.Missed || c.status === ContributionStatus.Partial).length;
    const collectionRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0;

    return {
      staff: { _id: staff._id.toString(), fullName: staff.fullName, staffId: staff.staffId, email: staff.email },
      kpis: { totalPaid, totalExpected, missedMonths, totalSurplus, collectionRate },
      years,
      rows,
    };
  }

  async generateStatementPdf(staffMongoId: string): Promise<Buffer> {
    const { staff, kpis, years, rows } = await this.getStaffContributionStatement(staffMongoId);
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

    const bodyRows = rows.map(row => {
      const cells = Array.from({ length: 12 }, (_, i) => {
        const c = row.cells[i + 1];
        if (!c) return `<td class="empty">—</td>`;
        const bg = statusColor[c.status] ?? '#fff';
        return `<td style="background:${bg}" title="${c.status}">${fmt(c.paidAmount)}</td>`;
      }).join('');
      return `<tr><td class="year-label">${row.year}</td>${cells}<td class="total">${fmt(row.yearTotal)}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:20px;color:#111}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:2px solid #bc4680;padding-bottom:12px}
  .org{font-size:18px;font-weight:bold;color:#bc4680}
  .title{font-size:13px;font-weight:bold;margin-top:4px}
  .meta{color:#666;font-size:10px;margin-top:2px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
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
</style>
</head>
<body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<div class="header">
  <div>
    <div class="org">NACOC Welfare</div>
    <div class="title">Contribution Statement - ${staff.fullName}</div>
    <div class="meta">Staff ID: ${staff.staffId} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString('en-GB')}</div>
  </div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kpi-label">Total Paid</div><div class="kpi-value">${fmt(kpis.totalPaid)}</div></div>
  <div class="kpi"><div class="kpi-label">Total Expected</div><div class="kpi-value">${fmt(kpis.totalExpected)}</div></div>
  <div class="kpi"><div class="kpi-label">Collection Rate</div><div class="kpi-value">${kpis.collectionRate}%</div></div>
  <div class="kpi"><div class="kpi-label">Missed / Partial</div><div class="kpi-value">${kpis.missedMonths} months</div></div>
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
  th{background:#bc4680;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
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
}
