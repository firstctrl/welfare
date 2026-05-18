import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, ContributionSource, ImportBatchStatus, PaginatedResult } from '@welfare/shared';
import { ImportBatch, ImportBatchDocument } from './schemas/import-batch.schema';
import { ContributionsService } from './contributions.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';

interface ExcelRow {
  'Staff ID'?: string;
  'Employee Name'?: string;
  Month?: number;
  Year?: number;
  Amount?: number;
}

@Injectable()
export class ImportService {
  constructor(
    @InjectModel(ImportBatch.name) private readonly batchModel: Model<ImportBatchDocument>,
    private readonly contributionsService: ContributionsService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    monthOverride: number | undefined,
    yearOverride: number | undefined,
    actorId: string,
    actorName: string,
  ): Promise<{ batchId: string; matched: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const firstRow = rows[0];
    const month = monthOverride ?? Number(firstRow.Month);
    const year = yearOverride ?? Number(firstRow.Year);
    if (!month || month < 1 || month > 12) throw new BadRequestException('Invalid or missing Month');
    if (!year || year < 2000) throw new BadRequestException('Invalid or missing Year');

    const batch = await this.batchModel.create({
      month, year, fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    let matched = 0;
    const flaggedEntries: { staffId: string; employeeName: string; amount: number; reason: string }[] = [];

    for (const row of rows) {
      const rawStaffId = String(row['Staff ID'] ?? '').trim();
      const employeeName = String(row['Employee Name'] ?? '').trim();
      const amount = Number(row.Amount ?? 0);

      if (!rawStaffId) {
        flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Missing Staff ID' });
        continue;
      }

      const staff = await this.staffService.findByStaffId(rawStaffId);
      if (!staff) {
        flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Staff ID not found' });
        continue;
      }

      await this.contributionsService.processPayment(
        staff._id.toString(), month, year, amount,
        ContributionSource.PayrollImport, actorId, actorName, batchId,
      );
      matched++;
    }

    const status = flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await this.batchModel.findByIdAndUpdate(batchId, {
      $set: { matchedRows: matched, flaggedRows: flaggedEntries.length, flaggedEntries, status },
    }).exec();

    this.auditService.log(
      actorId, actorName, AuditAction.Import, AuditEntity.ImportBatch, batchId,
    );

    return { batchId, matched, flagged: flaggedEntries.length, total: rows.length };
  }

  async getBatch(batchId: string): Promise<ImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<ImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resolveFlagged(
    batchId: string,
    originalStaffId: string,
    resolvedStaffMongoId: string,
    actorId: string,
    actorName: string,
  ): Promise<ImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    const entryIndex = batch.flaggedEntries.findIndex((e) => e.staffId === originalStaffId);
    if (entryIndex === -1) throw new NotFoundException(`Flagged entry ${originalStaffId} not found`);

    const entry = batch.flaggedEntries[entryIndex];
    await this.contributionsService.processPayment(
      resolvedStaffMongoId, batch.month, batch.year, entry.amount,
      ContributionSource.PayrollImport, actorId, actorName, batchId,
    );

    batch.flaggedEntries.splice(entryIndex, 1);
    batch.matchedRows += 1;
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();

    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }
}
