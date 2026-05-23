import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';
import { LoansService } from './loans.service';
import { LoansImportService } from './loans.import.service';
import { LoansRecordsImportService } from './loans.records.import.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ExitSettlementDto } from './dto/exit-settlement.dto';
import { LoanQueryDto } from './dto/loan-query.dto';

@Controller('loans')
export class LoansController {
  constructor(
    private readonly loansService: LoansService,
    private readonly importService: LoansImportService,
    private readonly recordsImportService: LoansRecordsImportService,
  ) {}

  @Post()
  @RequirePermission(AppModule.Loans, 'full')
  create(
    @Body() dto: CreateLoanDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.create(dto, user.sub, user.displayName);
  }

  @Get('bad-debt')
  @RequirePermission(AppModule.Loans, 'readonly')
  getBadDebt(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.loansService.findBadDebt(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('guarantor/:staffId')
  @RequirePermission(AppModule.Loans, 'readonly')
  getByGuarantor(
    @Param('staffId') staffId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loansService.findByGuarantor(
      staffId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get()
  @RequirePermission(AppModule.Loans, 'readonly')
  findAll(@Query() query: LoanQueryDto) {
    return this.loansService.findAll(query);
  }

  // ── import routes must be before :id to avoid param conflict ──

  @Post('import')
  @RequirePermission(AppModule.Loans, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importRepayments(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.processImport(file.buffer, file.originalname, user.sub, user.displayName);
  }

  @Get('import')
  @RequirePermission(AppModule.Loans, 'readonly')
  listImportBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  @RequirePermission(AppModule.Loans, 'readonly')
  getImportBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/resolve')
  @RequirePermission(AppModule.Loans, 'full')
  resolveFlagged(
    @Param('batchId') batchId: string,
    @Body() dto: { rowNumber: number; resolvedLoanId: string },
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveFlagged(
      batchId,
      dto.rowNumber,
      dto.resolvedLoanId,
      user.sub,
      user.displayName,
    );
  }

  // ── loan records import routes ──

  @Post('records-import')
  @RequirePermission(AppModule.Loans, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importLoanRecords(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.recordsImportService.processImport(file.buffer, file.originalname, user.sub, user.displayName);
  }

  @Get('records-import')
  @RequirePermission(AppModule.Loans, 'readonly')
  listLoanRecordsImportBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recordsImportService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('records-import/:batchId')
  @RequirePermission(AppModule.Loans, 'readonly')
  getLoanRecordsImportBatch(@Param('batchId') batchId: string) {
    return this.recordsImportService.getBatch(batchId);
  }

  // ── param routes ──

  @Get(':id')
  @RequirePermission(AppModule.Loans, 'readonly')
  findOne(@Param('id') id: string) {
    return this.loansService.findOne(id);
  }

  @Get(':id/schedule')
  @RequirePermission(AppModule.Loans, 'readonly')
  getSchedule(@Param('id') id: string) {
    return this.loansService.getRepaymentSchedule(id);
  }

  @Get(':id/document')
  @RequirePermission(AppModule.Loans, 'readonly')
  getDocument(@Param('id') id: string) {
    return this.loansService.getDocumentUrl(id);
  }

  @Post(':id/document')
  @RequirePermission(AppModule.Loans, 'full')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.uploadDocument(id, file, user.sub, user.displayName);
  }

  @Post(':id/repayments')
  @RequirePermission(AppModule.Loans, 'full')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.recordPayment(id, dto, user.sub, user.displayName);
  }

  @Patch(':id/write-off')
  @RequirePermission(AppModule.Loans, 'full')
  writeOff(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.writeOff(id, user.sub, user.displayName);
  }

  @Post(':id/settle-exit')
  @RequirePermission(AppModule.Loans, 'full')
  exitSettle(
    @Param('id') id: string,
    @Body() dto: ExitSettlementDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.exitSettle(id, dto, user.sub, user.displayName);
  }

  @Delete(':id/repayments/:repaymentId')
  @RequirePermission(AppModule.Loans, 'full')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRepayment(
    @Param('id') id: string,
    @Param('repaymentId') repaymentId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.deleteRepayment(id, repaymentId, user.sub, user.displayName);
  }

  @Delete(':id')
  @RequirePermission(AppModule.Loans, 'full')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLoan(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.deleteLoan(id, user.sub, user.displayName);
  }
}
