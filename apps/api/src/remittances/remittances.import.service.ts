import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { RemittanceImportBatch, RemittanceImportBatchDocument } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';

interface RemittanceExcelRow {
  Month?: number;
  Year?: number;
  'Receipt Date'?: string;
}

@Injectable()
export class RemittancesImportService {
  constructor(
    @InjectModel(RemittanceImportBatch.name)
    private readonly batchModel: Model<RemittanceImportBatchDocument>,
    private readonly remittancesService: RemittancesService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
  ): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<RemittanceExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      fileName,
      recordedBy: actorName,
      total: rows.length,
      imported: 0,
      flagged: 0,
      flaggedRows: [],
    });

    let imported = 0;
    const flaggedRows: Array<{ rowNumber: number; month: number; year: number; flagReason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const month = Number(row.Month ?? 0);
      const year = Number(row.Year ?? 0);
      const receiptDate = String(row['Receipt Date'] ?? '').trim();

      if (!month || month < 1 || month > 12) {
        flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Invalid or missing Month (must be 1–12)' });
        continue;
      }
      if (!year || year < 2000) {
        flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Invalid or missing Year (must be ≥ 2000)' });
        continue;
      }
      if (!receiptDate) {
        flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Missing Receipt Date' });
        continue;
      }

      try {
        await this.remittancesService.create({ month, year, receiptDate }, actorId);
        imported++;
      } catch (err: any) {
        const isDuplicate = err?.status === 409 || err?.message?.includes('already exists');
        flaggedRows.push({
          rowNumber: i + 2,
          month,
          year,
          flagReason: isDuplicate ? 'Duplicate period' : (err?.message ?? 'Unknown error'),
        });
      }
    }

    await this.batchModel.updateOne(
      { _id: batch._id },
      { imported, flagged: flaggedRows.length, flaggedRows },
    );

    return { batchId: batch._id.toString(), imported, flagged: flaggedRows.length, total: rows.length };
  }
}
