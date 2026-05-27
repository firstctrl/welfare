import {
  BadRequestException,
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
import { AppModule } from '@welfare/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { InvestmentsService } from './investments.service';
import { InvestmentsImportService } from './investments.import.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { UpdateInvestmentDto } from './dto/update-investment.dto';

@Controller('investments')
export class InvestmentsController {
  constructor(
    private readonly service: InvestmentsService,
    private readonly importService: InvestmentsImportService,
  ) {}

  @Get()
  @RequirePermission(AppModule.Investments, 'readonly')
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(page ? +page : 1, limit ? +limit : 20);
  }

  @Post()
  @RequirePermission(AppModule.Investments, 'full')
  create(
    @Body() dto: CreateInvestmentDto,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.service.create(dto, user._id.toString());
  }

  @Patch(':id')
  @RequirePermission(AppModule.Investments, 'full')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestmentDto,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    const { reason, ...fields } = dto;
    return this.service.update(id, fields, reason, user._id.toString());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Investments, 'full')
  async remove(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    await this.service.softDelete(id, reason, user._id.toString());
  }

  @Post('import')
  @RequirePermission(AppModule.Investments, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.processImport(file.buffer, file.originalname, user._id.toString(), user.displayName);
  }
}
