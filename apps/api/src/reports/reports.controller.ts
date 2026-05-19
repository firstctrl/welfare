import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

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
};

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  getDashboard() {
    return this.reportsService.getDashboardStats();
  }

  @Get('contributions/monthly')
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
  getGuarantorExposure() {
    return this.reportsService.getGuarantorExposure();
  }

  @Get('loans/bad-debt')
  async getBadDebt(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getBadDebt();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="bad-debt.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.badDebt.map(c => c.field));
    }
    return rows;
  }

  @Get('staff/exit')
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
