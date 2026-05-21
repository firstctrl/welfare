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
import { LoansService } from './loans.service';
import { LoansImportService } from './loans.import.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ExitSettlementDto } from './dto/exit-settlement.dto';
import { LoanQueryDto } from './dto/loan-query.dto';

@Controller('loans')
export class LoansController {
  constructor(
    private readonly loansService: LoansService,
    private readonly importService: LoansImportService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateLoanDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.create(dto, user.sub, user.displayName);
  }

  @Get('bad-debt')
  getBadDebt(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.loansService.findBadDebt(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('guarantor/:staffId')
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
  findAll(@Query() query: LoanQueryDto) {
    return this.loansService.findAll(query);
  }

  // ── import routes must be before :id to avoid param conflict ──

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importRepayments(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.processImport(file.buffer, file.originalname, user.sub, user.displayName);
  }

  @Get('import')
  listImportBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  getImportBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/resolve')
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

  // ── param routes ──

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.loansService.findOne(id);
  }

  @Get(':id/schedule')
  getSchedule(@Param('id') id: string) {
    return this.loansService.getRepaymentSchedule(id);
  }

  @Get(':id/document')
  getDocument(@Param('id') id: string) {
    return this.loansService.getDocumentUrl(id);
  }

  @Post(':id/document')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.uploadDocument(id, file, user.sub, user.displayName);
  }

  @Post(':id/repayments')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.recordPayment(id, dto, user.sub, user.displayName);
  }

  @Post(':id/settle-exit')
  exitSettle(
    @Param('id') id: string,
    @Body() dto: ExitSettlementDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.exitSettle(id, dto, user.sub, user.displayName);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLoan(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.deleteLoan(id, user.sub, user.displayName);
  }
}
