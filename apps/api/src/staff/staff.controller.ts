import {
  Body,
  Controller,
  Get,
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
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { StaffQueryDto } from './dto/staff-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

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
