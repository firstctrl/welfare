import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule, AuditAction, AuditEntity } from '@welfare/shared';
import { EmailService } from './email.service';
import { AnnualStatementJob } from './jobs/annual-statement.job';
import { EmailLogStatus, EmailLogType, EmailTriggerSource } from '@welfare/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@Controller('email')
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly annualStatementJob: AnnualStatementJob,
    private readonly auditService: AuditService,
  ) {}

  @Get('logs')
  @RequirePermission(AppModule.EmailLog, 'readonly')
  getLogs(
    @Query('staffId') staffId?: string,
    @Query('type') type?: EmailLogType,
    @Query('status') status?: EmailLogStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.emailService.listLogs({
      staffId,
      type,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('contribution-statement/bulk')
  @RequirePermission(AppModule.EmailLog, 'full')
  async bulkStatement(@CurrentUser() user: { sub: string; displayName: string }) {
    await this.annualStatementJob.run();
    await this.auditService.log(
      user.sub, user.displayName, AuditAction.GenerateStatement, AuditEntity.EmailLog,
      'contribution-statement-bulk', undefined, { triggeredBy: 'manual' },
    );
    return { message: 'Annual statement batch enqueued' };
  }

  @Post('contribution-statement/:staffId')
  @RequirePermission(AppModule.EmailLog, 'full')
  async sendContributionStatement(
    @Param('staffId') staffId: string,
    @Query('year') yearStr: string | undefined,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
    await this.emailService.sendContributionStatementForStaff(
      staffId,
      year,
      EmailTriggerSource.Manual,
    );
    await this.auditService.log(
      user.sub, user.displayName, AuditAction.GenerateStatement, AuditEntity.Staff, staffId,
      undefined, { report: 'contribution-statement', year, triggeredBy: 'manual' },
    );
    return { message: 'Contribution statement sent' };
  }

  @Post('loan-schedule/:loanId')
  @RequirePermission(AppModule.EmailLog, 'full')
  async sendLoanSchedule(
    @Param('loanId') loanId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    await this.emailService.sendLoanScheduleById(loanId, EmailTriggerSource.Manual);
    await this.auditService.log(
      user.sub, user.displayName, AuditAction.GenerateStatement, AuditEntity.Loan, loanId,
      undefined, { report: 'loan-schedule', triggeredBy: 'manual' },
    );
    return { message: 'Loan schedule sent' };
  }
}
