import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, PaginatedResult } from '@welfare/shared';
import { InvestmentImportBatch, InvestmentImportBatchDocument } from './schemas/investment-import-batch.schema';
import { InvestmentsService } from './investments.service';
import { normalizeExcelDate } from '../common/utils/excel-date.util';
import { ImportProgressService } from '../common/import-progress.service';
import { AuditService } from '../audit/audit.service';

interface InvestmentExcelRow {
  'Purchase Date'?: string | number | Date;
  Description?: string;
  Cost?: number;
  'Maturity Date'?: string | number | Date;
  'Face Value'?: number;
  Instruction?: string;
}

@Injectable()
export class InvestmentsImportService {
  constructor(
    @InjectModel(InvestmentImportBatch.name)
    private readonly batchModel: Model<InvestmentImportBatchDocument>,
    private readonly investmentsService: InvestmentsService,
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
    const rows = XLSX.utils.sheet_to_json<InvestmentExcelRow>(sheet);

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
    const flaggedRows: Array<{ rowNumber: number; description: string; flagReason: string }> = [];

    this.progressService.start(batchId, rows.length);
    try {
      for (let i = 0; i < rows.length; i++) {
        this.progressService.increment(batchId);

        const row = rows[i];
        const description = String(row.Description ?? '').trim();
        const cost = Number(row.Cost ?? 0);
        const faceValue = Number(row['Face Value'] ?? 0);
        const instruction = String(row.Instruction ?? '').trim() as 'One-Time' | 'Roll-Over';
        const purchaseDateRaw = normalizeExcelDate(row['Purchase Date']);
        const maturityDateRaw = normalizeExcelDate(row['Maturity Date']);

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
        if (isNaN(new Date(purchaseDateRaw).getTime())) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid Purchase Date' });
          continue;
        }
        if (isNaN(new Date(maturityDateRaw).getTime())) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid Maturity Date' });
          continue;
        }
        if (!['One-Time', 'Roll-Over'].includes(instruction)) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: `Invalid Instruction: "${instruction}" (must be One-Time or Roll-Over)` });
          continue;
        }

        try {
          await this.investmentsService.create(
            { purchaseDate: purchaseDateRaw, description, cost, maturityDate: maturityDateRaw, faceValue, instruction },
            actorId,
          );
          imported++;
        } catch (err: any) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: err?.message ?? 'Unknown error' });
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

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<InvestmentImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<InvestmentImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<InvestmentImportBatchDocument> {
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

  async deleteBatch(batchId: string, actorId: string, actorName: string): Promise<void> {
    const result = await this.batchModel.findByIdAndDelete(batchId).exec();
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.ImportBatch, batchId);
  }
}
