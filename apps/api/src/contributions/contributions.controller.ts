import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContributionsService } from './contributions.service';
import { ImportService } from './import.service';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { ResolveFlaggedDto } from './dto/resolve-flagged.dto';
import { ResolveByStaffIdDto } from './dto/resolve-by-staff-id.dto';
import { DismissFlaggedEntryDto } from './dto/dismiss-flagged-entry.dto';
import { ContributionQueryDto } from './dto/contribution-query.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';

@Controller('contributions')
export class ContributionsController {
  constructor(
    private readonly contributionsService: ContributionsService,
    private readonly importService: ImportService,
  ) {}

  @Post('import')
  @RequirePermission(AppModule.Contributions, 'full')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('month') month?: string,
    @Body('year') year?: string,
    @Body('jobId') jobId?: string,
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
      jobId,
    );
  }

  @Get('import')
  @RequirePermission(AppModule.Contributions, 'readonly')
  listBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  @RequirePermission(AppModule.Contributions, 'readonly')
  getBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/resolve')
  @RequirePermission(AppModule.Contributions, 'full')
  resolveFlagged(
    @Param('batchId') batchId: string,
    @Body() dto: ResolveFlaggedDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveFlagged(
      batchId, dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName,
    );
  }

  @Patch('import/resolve-by-staff-id')
  @RequirePermission(AppModule.Contributions, 'full')
  resolveByStaffId(
    @Body() dto: ResolveByStaffIdDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveByStaffId(
      dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName,
    );
  }

  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Contributions, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Delete('import/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Contributions, 'full')
  async deleteImportBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    await this.importService.deleteBatch(batchId, user.sub, user.displayName);
  }

  @Post('manual')
  @RequirePermission(AppModule.Contributions, 'full')
  manualEntry(
    @Body() dto: ManualEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.contributionsService.processLumpSum(
      dto.staffId, dto.amount, dto.month, dto.year, user.sub, user.displayName,
    );
  }

  @Get('summary')
  @RequirePermission(AppModule.Contributions, 'readonly')
  getSummary(@Query('month') month: string, @Query('year') year: string) {
    return this.contributionsService.getSummary(parseInt(month, 10), parseInt(year, 10));
  }

  @Get('staff/:staffId')
  @RequirePermission(AppModule.Contributions, 'readonly')
  getByStaff(@Param('staffId') staffId: string) {
    return this.contributionsService.findByStaff(staffId);
  }

  @Get()
  @RequirePermission(AppModule.Contributions, 'readonly')
  findAll(@Query() query: ContributionQueryDto) {
    return this.contributionsService.findAll(query);
  }

  @Delete('bulk')
  @RequirePermission(AppModule.Contributions, 'full')
  @HttpCode(HttpStatus.OK)
  bulkDelete(
    @Body() dto: BulkDeleteDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.contributionsService.bulkDeleteContributions(dto.ids, user.sub, user.displayName);
  }

  @Delete(':id')
  @RequirePermission(AppModule.Contributions, 'full')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.contributionsService.deleteContribution(id, user.sub, user.displayName);
  }
}
