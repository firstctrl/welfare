import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { InvestmentImportBatch, InvestmentImportBatchDocument } from './schemas/investment-import-batch.schema';
import { InvestmentsService } from './investments.service';

interface InvestmentExcelRow {
  'Purchase Date'?: any;
  Description?: string;
  Cost?: number;
  'Maturity Date'?: any;
  'Face Value'?: number;
  Instruction?: string;
}

@Injectable()
export class InvestmentsImportService {
  constructor(
    @InjectModel(InvestmentImportBatch.name)
    private readonly batchModel: Model<InvestmentImportBatchDocument>,
    private readonly investmentsService: InvestmentsService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
  ): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<InvestmentExcelRow>(sheet);

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
    const flaggedRows: Array<{ rowNumber: number; description: string; flagReason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const description = String(row.Description ?? '').trim();
      const cost = Number(row.Cost ?? 0);
      const faceValue = Number(row['Face Value'] ?? 0);
      const instruction = String(row.Instruction ?? '').trim() as 'One-Time' | 'Roll-Over';
      const purchaseDateRaw = row['Purchase Date'];
      const maturityDateRaw = row['Maturity Date'];

      if (!description) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Missing Description' });
        continue;
      }
      if (!cost || cost <= 0) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid or missing Cost' });
        continue;
      }
      if (!faceValue || faceValue <= 0) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid or missing Face Value' });
        continue;
      }
      if (!purchaseDateRaw) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Missing Purchase Date' });
        continue;
      }
      if (!maturityDateRaw) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Missing Maturity Date' });
        continue;
      }
      if (!['One-Time', 'Roll-Over'].includes(instruction)) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: `Invalid Instruction: "${instruction}" (must be One-Time or Roll-Over)` });
        continue;
      }

      try {
        const purchaseDate = purchaseDateRaw instanceof Date
          ? purchaseDateRaw.toISOString()
          : String(purchaseDateRaw);
        const maturityDate = maturityDateRaw instanceof Date
          ? maturityDateRaw.toISOString()
          : String(maturityDateRaw);

        await this.investmentsService.create(
          { purchaseDate, description, cost, maturityDate, faceValue, instruction },
          actorId,
        );
        imported++;
      } catch (err: any) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: err?.message ?? 'Unknown error' });
      }
    }

    await this.batchModel.updateOne(
      { _id: batch._id },
      { imported, flagged: flaggedRows.length, flaggedRows },
    );

    return { batchId: batch._id.toString(), imported, flagged: flaggedRows.length, total: rows.length };
  }
}
