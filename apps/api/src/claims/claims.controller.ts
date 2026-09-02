import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppModule, UserRole } from '@welfare/shared';
import { ClaimsService } from './claims.service';
import { ImportService } from './import.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { RejectClaimDto } from './dto/reject-claim.dto';
import { ClaimQueryDto } from './dto/claim-query.dto';
import { ResolveFlaggedDto } from './dto/resolve-flagged.dto';
import { ResolveByStaffIdDto } from './dto/resolve-by-staff-id.dto';
import { DismissFlaggedEntryDto } from './dto/dismiss-flagged-entry.dto';
import { BulkDeleteClaimsDto } from './dto/bulk-delete-claims.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';

@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly importService: ImportService,
  ) {}

  @Post('import')
  @RequirePermission(AppModule.Claims, 'full')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId?: string,
    @CurrentUser() user?: { sub: string; displayName: string },
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.importService.processImport(
      file.buffer, file.originalname, user?.sub ?? 'system', user?.displayName ?? 'system', jobId,
    );
  }

  @Get('import')
  @RequirePermission(AppModule.Claims, 'readonly')
  listBatches(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  @RequirePermission(AppModule.Claims, 'readonly')
  getBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/resolve')
  @RequirePermission(AppModule.Claims, 'full')
  resolveFlagged(
    @Param('batchId') batchId: string,
    @Body() dto: ResolveFlaggedDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveFlagged(batchId, dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName);
  }

  @Patch('import/resolve-by-staff-id')
  @RequirePermission(AppModule.Claims, 'full')
  resolveByStaffId(
    @Body() dto: ResolveByStaffIdDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveByStaffId(dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName);
  }

  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Claims, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Patch('import/:batchId/clear-flagged')
  @RequirePermission(AppModule.Claims, 'full')
  clearFlaggedEntries(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.clearFlaggedEntries(batchId, user.sub, user.displayName);
  }

  @Post()
  @RequirePermission(AppModule.Claims, 'full')
  create(
    @Body() dto: CreateClaimDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.createClaim(dto, user.sub, user.displayName);
  }

  @Patch(':id')
  @RequirePermission(AppModule.Claims, 'full')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClaimDto,
    @CurrentUser() user: { sub: string; displayName: string; role: UserRole },
  ) {
    return this.claimsService.updateClaim(id, dto, user.sub, user.displayName, user.role);
  }

  @Patch(':id/approve')
  @RequirePermission(AppModule.Claims, 'full')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.approveClaim(id, user.sub, user.displayName);
  }

  @Patch(':id/reject')
  @RequirePermission(AppModule.Claims, 'full')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectClaimDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.rejectClaim(id, dto.reason, user.sub, user.displayName);
  }

  @Get('staff/:staffId')
  @RequirePermission(AppModule.Claims, 'readonly')
  getByStaff(@Param('staffId') staffId: string) {
    return this.claimsService.findByStaff(staffId);
  }

  @Get('staff/:staffId/balance')
  @RequirePermission(AppModule.Claims, 'readonly')
  getBalance(@Param('staffId') staffId: string) {
    return this.claimsService.getStaffBalance(staffId).then((balance) => ({ balance }));
  }

  @Get()
  @RequirePermission(AppModule.Claims, 'readonly')
  findAll(@Query() query: ClaimQueryDto) {
    return this.claimsService.listClaims(query);
  }

  @Get(':id')
  @RequirePermission(AppModule.Claims, 'readonly')
  findOne(@Param('id') id: string) {
    return this.claimsService.findByIdWithStaff(id);
  }

  @Delete('bulk')
  @RequirePermission(AppModule.Claims, 'full')
  @HttpCode(HttpStatus.OK)
  bulkDelete(
    @Body() dto: BulkDeleteClaimsDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.bulkDeleteClaims(dto.ids, user.sub, user.displayName);
  }

  @Delete(':id')
  @RequirePermission(AppModule.Claims, 'full')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.deleteClaim(id, user.sub, user.displayName);
  }
}
