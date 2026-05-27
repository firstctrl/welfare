import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { parse as toCsv } from 'json2csv';
import puppeteer from 'puppeteer';
import { AppModule } from '@welfare/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RemittancesService } from './remittances.service';
import { RemittancesImportService } from './remittances.import.service';
import { CreateRemittanceDto } from './dto/create-remittance.dto';
import { RemittanceQueryDto } from './dto/remittance-query.dto';

const CSV_COLUMNS = [
  { header: 'Period',           field: 'period' },
  { header: 'Receipt Date',     field: 'receiptDate' },
  { header: 'Gross Amt (GHS)',  field: 'grossAmount' },
  { header: 'Charges (GHS)',    field: 'charges' },
  { header: 'Net Payable (GHS)',field: 'netPayable' },
];

@Controller('remittances')
export class RemittancesController {
  constructor(
    private readonly service: RemittancesService,
    private readonly importService: RemittancesImportService,
  ) {}

  @Get('gross')
  @RequirePermission(AppModule.Remittances, 'readonly')
  getGross(@Query('month') month: string, @Query('year') year: string) {
    if (!month || !year) throw new BadRequestException('month and year are required');
    return this.service.getGrossPreview(+month, +year);
  }

  @Get()
  @RequirePermission(AppModule.Remittances, 'readonly')
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(page ? +page : 1, limit ? +limit : 20);
  }

  @Post()
  @RequirePermission(AppModule.Remittances, 'full')
  create(
    @Body() dto: CreateRemittanceDto,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.service.create(dto, user._id.toString());
  }

  @Post('import')
  @RequirePermission(AppModule.Remittances, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.processImport(file.buffer, file.originalname, user._id.toString(), user.displayName);
  }

  @Get('report')
  @RequirePermission(AppModule.Remittances, 'readonly')
  async getReport(
    @Query() q: RemittanceQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fm = q.fromMonth ?? 1;
    const fy = q.fromYear ?? new Date().getFullYear();
    const tm = q.toMonth ?? 12;
    const ty = q.toYear ?? new Date().getFullYear();

    if (ty < fy || (ty === fy && (tm ?? 12) < (fm ?? 1))) {
      throw new BadRequestException('To period must not precede From period');
    }

    const report = await this.service.getReport(fm, fy, tm, ty);

    if (q.format === 'csv') {
      const fields = CSV_COLUMNS.map(c => c.field);
      const csv = toCsv(report.rows, { fields });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="remittances-${fy}-${fm}-to-${ty}-${tm}.csv"`);
      res.send(csv);
      return;
    }

    if (q.format === 'pdf') {
      const logoPath = path.join(__dirname, '..', 'reports', 'assets', 'ncc-logo.png');
      const logoBase64 = fs.existsSync(logoPath)
        ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
        : '';

      const headers = CSV_COLUMNS.map(c => `<th>${c.header}</th>`).join('');
      const bodyRows = report.rows
        .map(row => `<tr>${CSV_COLUMNS.map(c => `<td>${(row as any)[c.field] ?? ''}</td>`).join('')}</tr>`)
        .join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:20px}
  h1{font-size:18px;margin-bottom:4px}
  .meta{color:#666;font-size:11px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{background:#bc4680;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px}
  tr:nth-child(even) td{background:#f9fafb}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;background-image:url('${logoBase64}');background-size:contain;background-repeat:no-repeat;background-position:center;opacity:0.05;z-index:0;pointer-events:none}
</style></head><body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<h1>Remittances Report</h1>
<div class="meta">Period: ${fm}/${fy} – ${tm}/${ty} | Generated: ${new Date().toLocaleString('en-GB')}</div>
<table><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`;

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', right: '10mm', bottom: '16mm', left: '10mm' } });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="remittances-report.pdf"`);
        res.end(Buffer.from(pdf));
      } finally {
        await browser.close();
      }
      return;
    }

    return report;
  }
}
