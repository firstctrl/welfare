import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, PaginatedResult } from '@welfare/shared';
import { RemittanceImportBatch, RemittanceImportBatchDocument } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';
import { normalizeExcelDate } from '../common/utils/excel-date.util';
import { ImportProgressService } from '../common/import-progress.service';
import { AuditService } from '../audit/audit.service';

interface RemittanceExcelRow {
  Month?: number;
  Year?: number;
  'Receipt Date'?: string | number | Date;
}

@Injectable()
export class RemittancesImportService {
  constructor(
    @InjectModel(RemittanceImportBatch.name)
    private readonly batchModel: Model<RemittanceImportBatchDocument>,
    private readonly remittancesService: RemittancesService,
    private readonly progressService: ImportProgressService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<RemittanceExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      recordedBy: actorName,
      total: rows.length,
      imported: 0,
      flagged: 0,
      flaggedRows: [],
    });
    const batchId = batch._id.toString();

    let imported = 0;
    const flaggedRows: Array<{ rowNumber: number; month: number; year: number; flagReason: string }> = [];

    this.progressService.start(batchId, rows.length);
    try {
      for (let i = 0; i < rows.length; i++) {
        this.progressService.increment(batchId);

        const row = rows[i];
        const month = Number(row.Month ?? 0);
        const year = Number(row.Year ?? 0);
        const receiptDate = normalizeExcelDate(row['Receipt Date']);

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
        if (isNaN(new Date(receiptDate).getTime())) {
          flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Invalid Receipt Date' });
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
    } finally {
      this.progressService.complete(batchId);
    }

    await this.batchModel.updateOne(
      { _id: batch._id },
      { imported, flagged: flaggedRows.length, flaggedRows },
    );

    return { batchId, imported, flagged: flaggedRows.length, total: rows.length };
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<RemittanceImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<RemittanceImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<RemittanceImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedRows.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedRows.splice(index, 1);
    batch.flagged -= 1;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }

  async clearFlaggedEntries(batchId: string, actorId: string, actorName: string): Promise<RemittanceImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    batch.flaggedRows = [];
    batch.flagged = 0;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }
}
