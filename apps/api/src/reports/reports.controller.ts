import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Response } from 'express';
import { EmailTriggerSource, StaffStatus } from '@welfare/shared';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ReportsService } from './reports.service';
import { ReportQueryDto, FundSummaryQueryDto } from './dto/report-query.dto';
import { EmailService } from '../email/email.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';

const CSV_COLUMNS = {
  monthlyContributions: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Expected (GHS)', field: 'expectedAmount' },
    { header: 'Paid (GHS)', field: 'paidAmount' },
    { header: 'Surplus C/F', field: 'surplusCarriedForward' },
    { header: 'Status', field: 'status' },
  ],
  arrears: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Month', field: 'month' },
    { header: 'Year', field: 'year' },
    { header: 'Expected (GHS)', field: 'expectedAmount' },
    { header: 'Paid (GHS)', field: 'paidAmount' },
    { header: 'Shortfall (GHS)', field: 'shortfall' },
    { header: 'Status', field: 'status' },
  ],
  activeLoans: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Guarantor', field: 'guarantorName' },
    { header: 'Principal (GHS)', field: 'principalAmount' },
    { header: 'Outstanding (GHS)', field: 'outstandingBalance' },
    { header: 'Disbursed', field: 'disbursedDate' },
  ],
  overdueLoans: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Instalment #', field: 'instalmentNumber' },
    { header: 'Due Date', field: 'dueDate' },
    { header: 'Due (GHS)', field: 'dueAmount' },
    { header: 'Paid (GHS)', field: 'paidAmount' },
    { header: 'Penalty (GHS)', field: 'penaltyAmount' },
    { header: 'Days Overdue', field: 'daysOverdue' },
  ],
  badDebt: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Principal (GHS)', field: 'principalAmount' },
    { header: 'Exit Deduction (GHS)', field: 'exitDeductionAmount' },
    { header: 'Guarantor Offset (GHS)', field: 'guarantorOffsetAmount' },
    { header: 'Bad Debt (GHS)', field: 'badDebtAmount' },
    { header: 'Settled At', field: 'settledAt' },
  ],
  exitClearance: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Status', field: 'status' },
    { header: 'Outstanding Loans (GHS)', field: 'outstandingLoanBalance' },
    { header: 'Missed Contributions', field: 'missedContributionsCount' },
  ],
  fundSummaryContributions: [
    { header: 'Month',           field: 'month' },
    { header: 'Year',            field: 'year' },
    { header: 'Expected (GHS)',  field: 'totalExpected' },
    { header: 'Collected (GHS)', field: 'totalCollected' },
    { header: 'Missed',          field: 'missedCount' },
    { header: 'Partial',         field: 'partialCount' },
  ],
  fundSummaryLoans: [
    { header: 'Status',      field: 'status' },
    { header: 'Count',       field: 'count' },
    { header: 'Total (GHS)', field: 'totalAmount' },
  ],
  fundSummaryDefaults: [
    { header: 'Staff Name',      field: 'staffName' },
    { header: 'Principal (GHS)', field: 'principalAmount' },
    { header: 'Recovered (GHS)', field: 'totalRecovered' },
    { header: 'Bad Debt (GHS)',  field: 'badDebtAmount' },
    { header: 'Settled At',      field: 'settledAt' },
  ],
};

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly emailService: EmailService,
    @InjectQueue('bulk-statements') private readonly bulkQueue: Queue,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
  ) {}

  @Get('dashboard')
  @RequirePermission(AppModule.Reports, 'readonly')
  getDashboard() {
    return this.reportsService.getDashboardStats();
  }

  @Get('contributions/staff-statement')
  @RequirePermission(AppModule.Reports, 'readonly')
  getStaffStatement(@Query('staffId') staffId: string) {
    if (!staffId) throw new BadRequestException('staffId is required');
    return this.reportsService.getStaffContributionStatement(staffId);
  }

  @Get('contributions/staff-statement/pdf')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getStaffStatementPdf(
    @Query('staffId') staffId: string,
    @Res() res: Response,
  ) {
    if (!staffId) throw new BadRequestException('staffId is required');
    const { staff } = await this.reportsService.getStaffContributionStatement(staffId);
    const pdf = await this.reportsService.generateStatementPdf(staffId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${staff.staffId}.pdf"`);
    res.end(pdf);
  }

  @Post('contributions/staff-statement/send')
  @RequirePermission(AppModule.Reports, 'full')
  async sendStaffStatement(
    @Body('staffId') staffId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    if (!staffId) throw new BadRequestException('staffId is required');
    const { staff } = await this.reportsService.getStaffContributionStatement(staffId);
    if (!staff.email) throw new BadRequestException('Staff has no email address on record');
    const pdf = await this.reportsService.generateStatementPdf(staffId);
    await this.emailService.sendWithAttachment(
      { staffId, staffName: staff.fullName, email: staff.email },
      `Your Welfare Department Contribution Statement`,
      `<p>Dear ${staff.fullName},</p><p>Please find attached your welfare contribution statement.</p><p>Welfare Department</p>`,
      [{ filename: `statement-${staff.staffId}.pdf`, content: pdf }],
      EmailTriggerSource.Manual,
    );
    return { sent: true, email: staff.email };
  }

  @Get('contributions/monthly')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getMonthlyContributions(
    @Query() q: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const now = new Date();
    const month = q.month ?? now.getMonth() + 1;
    const year = q.year ?? now.getFullYear();
    const report = await this.reportsService.getMonthlyContributions(month, year);

    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="contributions-${year}-${month}.csv"`);
      return this.reportsService.generateCsv(report.rows, CSV_COLUMNS.monthlyContributions.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf(
        `Contributions Monthly Report — ${month}/${year}`,
        CSV_COLUMNS.monthlyContributions,
        report.rows,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="contributions-${year}-${month}.pdf"`);
      res.end(pdf);
      return;
    }
    return report;
  }

  @Get('contributions/arrears')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getArrears(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const now = new Date();
    const fromMonth = q.fromMonth ?? 1;
    const fromYear = q.fromYear ?? now.getFullYear();
    const toMonth = q.toMonth ?? now.getMonth() + 1;
    const toYear = q.toYear ?? now.getFullYear();
    const rows = await this.reportsService.getArrearsReport(fromMonth, fromYear, toMonth, toYear);

    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="arrears.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.arrears.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf('Contribution Arrears Report', CSV_COLUMNS.arrears, rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="arrears.pdf"');
      res.end(pdf);
      return;
    }
    return rows;
  }

  @Get('contributions/guarantor-offsets')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getGuarantorOffsets(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getGuarantorOffsets();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="guarantor-offsets.csv"');
      return this.reportsService.generateCsv(rows, [
        'guarantorName', 'borrowerName', 'loanId', 'instalmentNumber', 'offsetAmount', 'offsetDate',
      ]);
    }
    return rows;
  }

  @Get('loans/active')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getActiveLoans(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getActiveLoans();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="active-loans.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.activeLoans.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf('Active Loans Report', CSV_COLUMNS.activeLoans, rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="active-loans.pdf"');
      res.end(pdf);
      return;
    }
    return rows;
  }

  @Get('loans/overdue')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getOverdueLoans(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getOverdueLoans();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="overdue-loans.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.overdueLoans.map(c => c.field));
    }
    return rows;
  }

  @Get('loans/repaid')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getRepaidLoans(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getRepaidLoans();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="repaid-loans.csv"');
      return this.reportsService.generateCsv(rows, [
        'staffName', 'principalAmount', 'totalRepayable', 'disbursedDate', 'settledAt', 'tenureMonths',
      ]);
    }
    return rows;
  }

  @Get('loans/guarantor-exposure')
  @RequirePermission(AppModule.Reports, 'readonly')
  getGuarantorExposure() {
    return this.reportsService.getGuarantorExposure();
  }

  @Get('loans/bad-debt')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getBadDebt(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getBadDebt();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="bad-debt.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.badDebt.map(c => c.field));
    }
    return rows;
  }

  @Get('loans/borrowers')
  @RequirePermission(AppModule.Reports, 'readonly')
  getLoanBorrowers() {
    return this.reportsService.getLoanBorrowers();
  }

  @Get('loans/staff-statement')
  @RequirePermission(AppModule.Reports, 'readonly')
  getLoanStatement(
    @Query('staffId') staffId: string,
    @Query('loanId') loanId: string,
  ) {
    if (!staffId) throw new BadRequestException('staffId is required');
    if (!loanId) throw new BadRequestException('loanId is required');
    return this.reportsService.getLoanStatement(staffId, loanId);
  }

  @Get('loans/staff-statement/pdf')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getLoanStatementPdf(
    @Query('staffId') staffId: string,
    @Query('loanId') loanId: string,
    @Res() res: Response,
  ) {
    if (!staffId) throw new BadRequestException('staffId is required');
    if (!loanId) throw new BadRequestException('loanId is required');
    const { staff, loan } = await this.reportsService.getLoanStatement(staffId, loanId);
    const pdf = await this.reportsService.generateLoanStatementPdf(staffId, loanId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="loan-statement-${staff.staffNo}-${loan.id}.pdf"`,
    );
    res.end(pdf);
  }

  @Post('loans/staff-statement/send')
  @RequirePermission(AppModule.Reports, 'full')
  async sendLoanStatement(
    @Body('staffId') staffId: string,
    @Body('loanId') loanId: string,
  ) {
    if (!staffId) throw new BadRequestException('staffId is required');
    if (!loanId) throw new BadRequestException('loanId is required');
    const stmt = await this.reportsService.getLoanStatement(staffId, loanId);
    const staffDoc = await this.staffModel.findById(staffId).exec();
    if (!staffDoc?.email) throw new BadRequestException('Staff has no email address on record');
    const pdf = await this.reportsService.generateLoanStatementPdf(staffId, loanId);
    await this.emailService.sendWithAttachment(
      { staffId, staffName: stmt.staff.displayName, email: staffDoc.email },
      `Your Welfare Department Loan Statement`,
      `<p>Dear ${stmt.staff.displayName},</p><p>Please find attached your welfare loan statement.</p><p>Welfare Department</p>`,
      [{ filename: `loan-statement-${stmt.staff.staffNo}-${stmt.loan.id}.pdf`, content: pdf }],
      EmailTriggerSource.Manual,
    );
    return { sent: true, email: staffDoc.email };
  }

  @Post('contributions/bulk-send')
  @RequirePermission(AppModule.Reports, 'full')
  async triggerBulkSend(
    @Body('year') year: number,
    @Body('sendTo') sendTo: 'all' | 'selected',
    @Body('staffIds') staffIds?: string[],
  ) {
    if (!year) throw new BadRequestException('year is required');

    let ids: string[];
    if (sendTo === 'selected') {
      if (!staffIds?.length) throw new BadRequestException('staffIds required when sendTo=selected');
      ids = staffIds;
    } else {
      const staff = await this.staffModel
        .find({ status: StaffStatus.Active, email: { $exists: true, $ne: '' } })
        .select('_id')
        .lean()
        .exec();
      ids = (staff as any[]).map((s: any) => s._id.toString());
    }

    if (ids.length === 0) throw new BadRequestException('No eligible staff found (active staff with email addresses)');

    const job = await this.bulkQueue.add('bulk-send', { staffIds: ids, year, triggeredBy: 'manual' });
    return { jobId: job.id, queued: ids.length };
  }

  @Get('fund-summary')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getFundSummary(@Query() dto: FundSummaryQueryDto) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    let fromMonth = dto.fromMonth ?? 1;
    let toMonth   = dto.toMonth ?? 12;
    if (dto.quarter) [fromMonth, toMonth] = quarterMap[dto.quarter];
    return this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
  }

  @Get('fund-summary/contributions')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getFundSummaryContributions(
    @Query() dto: FundSummaryQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    let fromMonth = dto.fromMonth ?? 1;
    let toMonth   = dto.toMonth ?? 12;
    if (dto.quarter) [fromMonth, toMonth] = quarterMap[dto.quarter];
    const summary = await this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
    if (dto.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="fund-contributions-${dto.year}.csv"`);
      return this.reportsService.generateCsv(
        summary.contributionBreakdown,
        CSV_COLUMNS.fundSummaryContributions.map(c => c.field),
      );
    }
    return summary.contributionBreakdown;
  }

  @Get('fund-summary/loans')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getFundSummaryLoans(
    @Query() dto: FundSummaryQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    let fromMonth = dto.fromMonth ?? 1;
    let toMonth   = dto.toMonth ?? 12;
    if (dto.quarter) [fromMonth, toMonth] = quarterMap[dto.quarter];
    const summary = await this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
    if (dto.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="fund-loans-${dto.year}.csv"`);
      return this.reportsService.generateCsv(summary.loanBreakdown, CSV_COLUMNS.fundSummaryLoans.map(c => c.field));
    }
    if (dto.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf(`Fund Summary — Loans ${dto.year}`, CSV_COLUMNS.fundSummaryLoans, summary.loanBreakdown);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="fund-loans-${dto.year}.pdf"`);
      res.end(pdf);
      return;
    }
    return summary.loanBreakdown;
  }

  @Get('fund-summary/defaults')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getFundSummaryDefaults(
    @Query() dto: FundSummaryQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    let fromMonth = dto.fromMonth ?? 1;
    let toMonth   = dto.toMonth ?? 12;
    if (dto.quarter) [fromMonth, toMonth] = quarterMap[dto.quarter];
    const summary = await this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
    if (dto.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="fund-defaults-${dto.year}.csv"`);
      return this.reportsService.generateCsv(summary.defaultDetails, CSV_COLUMNS.fundSummaryDefaults.map(c => c.field));
    }
    if (dto.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf(`Fund Summary — Defaulted Loans ${dto.year}`, CSV_COLUMNS.fundSummaryDefaults, summary.defaultDetails);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="fund-defaults-${dto.year}.pdf"`);
      res.end(pdf);
      return;
    }
    return summary.defaultDetails;
  }

  @Get('contributions/bulk-send/status')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getBulkSendStatus(@Query('jobId') jobId: string) {
    if (!jobId) throw new BadRequestException('jobId is required');
    const job = await this.bulkQueue.getJob(jobId);
    if (!job) throw new BadRequestException('Job not found');
    const state = await job.getState();
    const progress = typeof job.progress === 'number' ? job.progress : 0;
    return {
      jobId: job.id,
      state,
      progress,
      queued: (job.data as any).staffIds?.length ?? 0,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
      createdAt: new Date(job.timestamp).toISOString(),
    };
  }

  @Get('staff-record/pdf')
  @RequirePermission(AppModule.Staff, 'readonly')
  async getStaffRecordPdf(
    @Query('staffId') staffId: string,
    @Res() res: Response,
  ) {
    if (!staffId) throw new BadRequestException('staffId is required');
    const pdf = await this.reportsService.generateStaffRecordPdf(staffId);
    const staffDoc = await this.staffModel.findById(staffId).exec();
    const filename = `staff-record-${staffDoc?.staffId ?? staffId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(pdf);
  }

  @Get('staff/exit')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getExitClearance(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getExitClearanceReport();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="exit-clearance.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.exitClearance.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf(
        'Staff Exit Clearance Report',
        CSV_COLUMNS.exitClearance,
        rows,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="exit-clearance.pdf"');
      res.end(pdf);
      return;
    }
    return rows;
  }
}
