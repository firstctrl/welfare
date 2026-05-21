import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContributionsService } from './contributions.service';
import { ImportService } from './import.service';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { ResolveFlaggedDto } from './dto/resolve-flagged.dto';
import { ContributionQueryDto } from './dto/contribution-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('contributions')
export class ContributionsController {
  constructor(
    private readonly contributionsService: ContributionsService,
    private readonly importService: ImportService,
  ) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('month') month?: string,
    @Body('year') year?: string,
    @CurrentUser() user?: { sub: string; displayName: string },
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.importService.processImport(
      file.buffer,
      file.originalname,
      month ? parseInt(month, 10) : undefined,
      year ? parseInt(year, 10) : undefined,
      user?.sub ?? 'system',
      user?.displayName ?? 'system',
    );
  }

  @Get('import')
  listBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  getBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/resolve')
  resolveFlagged(
    @Param('batchId') batchId: string,
    @Body() dto: ResolveFlaggedDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveFlagged(
      batchId, dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName,
    );
  }

  @Post('manual')
  manualEntry(
    @Body() dto: ManualEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.contributionsService.processLumpSum(
      dto.staffId, dto.amount, dto.month, dto.year, user.sub, user.displayName,
    );
  }

  @Get('summary')
  getSummary(@Query('month') month: string, @Query('year') year: string) {
    return this.contributionsService.getSummary(parseInt(month, 10), parseInt(year, 10));
  }

  @Get('staff/:staffId')
  getByStaff(@Param('staffId') staffId: string) {
    return this.contributionsService.findByStaff(staffId);
  }

  @Get()
  findAll(@Query() query: ContributionQueryDto) {
    return this.contributionsService.findAll(query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.contributionsService.deleteContribution(id, user.sub, user.displayName);
  }
}
