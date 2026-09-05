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
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { StaffService } from './staff.service';
import { StaffImportService } from './staff.import.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { CorrectStatusDto } from './dto/correct-status.dto';
import { StaffQueryDto } from './dto/staff-query.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { DismissFlaggedEntryDto } from './dto/dismiss-flagged-entry.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppModule, UserRole } from '@welfare/shared';

@Controller('staff')
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly importService: StaffImportService,
  ) {}

  // ── import routes must be before :id to avoid param conflict ──
  @Post('import')
  @RequirePermission(AppModule.Staff, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importStaff(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId: string | undefined,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.processImport(file.buffer, file.originalname, user.sub, user.displayName, jobId);
  }

  @Get('import')
  @RequirePermission(AppModule.Staff, 'readonly')
  listImportBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  @RequirePermission(AppModule.Staff, 'readonly')
  getImportBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Staff, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Patch('import/:batchId/clear-flagged')
  @RequirePermission(AppModule.Staff, 'full')
  clearFlaggedEntries(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.clearFlaggedEntries(batchId, user.sub, user.displayName);
  }

  @Post()
  @RequirePermission(AppModule.Staff, 'full')
  create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: { sub: string; displayName: string },
    @Req() req: Request,
  ) {
    return this.staffService.create(dto, user.sub, user.displayName, req.ip);
  }

  @Get()
  @RequirePermission(AppModule.Staff, 'readonly')
  findAll(@Query() query: StaffQueryDto) {
    return this.staffService.findAll(query);
  }

  @Delete('bulk')
  @RequirePermission(AppModule.Staff, 'full')
  @HttpCode(HttpStatus.OK)
  bulkDelete(
    @Body() dto: BulkDeleteDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.staffService.bulkDeleteStaff(dto.ids, user.sub, user.displayName);
  }

  @Get(':id')
  @RequirePermission(AppModule.Staff, 'readonly')
  findOne(@Param('id') id: string) {
    return this.staffService.findById(id);
  }

  @Patch(':id')
  @RequirePermission(AppModule.Staff, 'full')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: { sub: string; displayName: string },
    @Req() req: Request,
  ) {
    return this.staffService.update(id, dto, user.sub, user.displayName, req.ip);
  }

  @Patch(':id/status')
  @RequirePermission(AppModule.Staff, 'full')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: { sub: string; displayName: string },
    @Req() req: Request,
  ) {
    return this.staffService.changeStatus(id, dto, user.sub, user.displayName, req.ip);
  }

  @Patch(':id/status/correct')
  @RequirePermission(AppModule.Staff, 'full')
  @Roles(UserRole.WelfareManager, UserRole.Admin)
  correctStatus(
    @Param('id') id: string,
    @Body() dto: CorrectStatusDto,
    @CurrentUser() user: { sub: string; displayName: string },
    @Req() req: Request,
  ) {
    return this.staffService.correctStatus(id, dto, user.sub, user.displayName, req.ip);
  }

  @Post(':id/photo')
  @RequirePermission(AppModule.Staff, 'full')
  @UseInterceptors(FileInterceptor('photo'))
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.staffService.uploadPhoto(id, file.buffer, file.mimetype);
  }

  @Get(':id/photo')
  @RequirePermission(AppModule.Staff, 'readonly')
  getPhoto(@Param('id') id: string) {
    return this.staffService.getPhotoUrl(id);
  }

  @Get(':id/eligibility')
  @RequirePermission(AppModule.Staff, 'readonly')
  checkEligibility(@Param('id') id: string) {
    return this.staffService.isLoanEligible(id);
  }
}
