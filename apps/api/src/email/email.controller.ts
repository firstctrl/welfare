import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';
import { EmailService } from './email.service';
import { AnnualStatementJob } from './jobs/annual-statement.job';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SendStatementDto } from './dto/send-statement.dto';
import { EmailLogStatus, EmailLogType, EmailTriggerSource } from '@welfare/shared';
import { UserDocument } from '../users/schemas/user.schema';

@Controller('email')
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly annualStatementJob: AnnualStatementJob,
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
  async bulkStatement() {
    await this.annualStatementJob.run();
    return { message: 'Annual statement batch enqueued' };
  }

  @Post('contribution-statement/:staffId')
  @RequirePermission(AppModule.EmailLog, 'full')
  async sendContributionStatement(
    @Param('staffId') staffId: string,
    @Query() dto: SendStatementDto,
  ) {
    await this.emailService.sendContributionStatementForStaff(
      staffId,
      dto.year ?? new Date().getFullYear(),
      EmailTriggerSource.Manual,
    );
    return { message: 'Contribution statement sent' };
  }

  @Post('loan-schedule/:loanId')
  @RequirePermission(AppModule.EmailLog, 'full')
  async sendLoanSchedule(@Param('loanId') loanId: string) {
    await this.emailService.sendLoanScheduleById(loanId, EmailTriggerSource.Manual);
    return { message: 'Loan schedule sent' };
  }
}
