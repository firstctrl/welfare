import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  AuditAction, AuditEntity, ClaimSource, ClaimStatus, ClaimType, CessationReason, ImportBatchStatus, PaginatedResult,
} from '@welfare/shared';
import { ClaimImportBatch, ClaimImportBatchDocument } from './schemas/claim-import-batch.schema';
import { Claim, ClaimDocument } from './schemas/claim.schema';
import { ClaimsService } from './claims.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

interface ExcelRow {
  'Staff ID'?: string;
  'Full Name'?: string;
  'Claim Type'?: string;
  Month?: number;
  Year?: number;
  Amount?: number;
  'Sub Reason'?: string;
}

const VALID_CLAIM_TYPES = new Set(Object.values(ClaimType));
const VALID_SUB_REASONS = new Set(Object.values(CessationReason));

@Injectable()
export class ImportService {
  constructor(
    @InjectModel(ClaimImportBatch.name) private readonly batchModel: Model<ClaimImportBatchDocument>,
    @InjectModel(Claim.name) private readonly claimModel: Model<ClaimDocument>,
    private readonly claimsService: ClaimsService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<{ batchId: string; matched: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    let matched = 0;
    const flaggedEntries: {
      staffId: string; employeeName: string; amount: number; reason: string;
      claimType?: string; month?: number; year?: number; subReason?: string;
    }[] = [];

    this.progressService.start(batchId, rows.length);
    try {
      for (const row of rows) {
        this.progressService.increment(batchId);

        const rawStaffId = String(row['Staff ID'] ?? '').trim();
        const employeeName = String(row['Full Name'] ?? '').trim();
        const claimTypeRaw = String(row['Claim Type'] ?? '').trim();
        const amount = Number(row.Amount ?? 0);
        const month = Number(row.Month);
        const year = Number(row.Year);
        const subReasonRaw = String(row['Sub Reason'] ?? '').trim();

        if (!rawStaffId) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Missing Staff ID', claimType: claimTypeRaw || undefined, month: month || undefined, year: year || undefined, subReason: subReasonRaw || undefined });
          continue;
        }
        if (!VALID_CLAIM_TYPES.has(claimTypeRaw as ClaimType)) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Claim Type', month: month || undefined, year: year || undefined });
          continue;
        }
        if (!month || month < 1 || month > 12) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Month', claimType: claimTypeRaw, year: year || undefined });
          continue;
        }
        if (!year || year < 2000) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Year', claimType: claimTypeRaw, month });
          continue;
        }
        const claimType = claimTypeRaw as ClaimType;
        let subReason: CessationReason | undefined;
        if (claimType === ClaimType.Cessation) {
          if (!VALID_SUB_REASONS.has(subReasonRaw as CessationReason)) {
            flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Missing Sub Reason for Cessation claim', claimType, month, year });
            continue;
          }
          subReason = subReasonRaw as CessationReason;
        }

        const staff = await this.staffService.findByStaffId(rawStaffId);
        if (!staff) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Staff ID not found', claimType, month, year, subReason });
          continue;
        }

        const staffMongoId = staff._id.toString();
        const balanceBefore = await this.claimsService.getStaffBalance(staffMongoId);

        await this.claimModel.create({
          staffId: staffMongoId,
          claimType,
          subReason,
          month,
          year,
          amount,
          status: ClaimStatus.Approved,
          source: ClaimSource.LegacyImport,
          importBatchId: batchId,
          recordedBy: actorName,
        });
        matched++;

        if (amount > balanceBefore) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Exceeds staff balance — review', claimType, month, year, subReason });
        }
      }
    } finally {
      this.progressService.complete(batchId);
    }

    const status = flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await this.batchModel.findByIdAndUpdate(batchId, {
      $set: { matchedRows: matched, flaggedRows: flaggedEntries.length, flaggedEntries, status },
    }).exec();

    this.auditService.log(actorId, actorName, AuditAction.Import, AuditEntity.ClaimImportBatch, batchId);

    return { batchId, matched, flagged: flaggedEntries.length, total: rows.length };
  }

  async getBatch(batchId: string): Promise<ClaimImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Claim import batch ${batchId} not found`);
    return batch;
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<ClaimImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resolveFlagged(
    batchId: string, originalStaffId: string, resolvedStaffMongoId: string, actorId: string, actorName: string,
  ): Promise<ClaimImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    const entryIndex = batch.flaggedEntries.findIndex((e) => e.staffId === originalStaffId);
    if (entryIndex === -1) throw new NotFoundException(`Flagged entry ${originalStaffId} not found`);
    await this.resolveOneEntry(batch, entryIndex, resolvedStaffMongoId, actorName);
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, batchId);
    return batch;
  }

  async resolveByStaffId(
    originalStaffId: string, resolvedStaffMongoId: string, actorId: string, actorName: string,
  ): Promise<{ resolvedCount: number; batchesUpdated: number }> {
    const batches = await this.batchModel
      .find({ status: { $ne: ImportBatchStatus.Completed }, 'flaggedEntries.staffId': originalStaffId })
      .exec();

    let resolvedCount = 0;
    let batchesUpdated = 0;
    for (const batch of batches) {
      let resolvedInBatch = 0;
      for (let i = batch.flaggedEntries.length - 1; i >= 0; i--) {
        if (batch.flaggedEntries[i].staffId !== originalStaffId) continue;
        await this.resolveOneEntry(batch, i, resolvedStaffMongoId, actorName);
        resolvedInBatch++;
      }
      if (resolvedInBatch > 0) {
        await batch.save();
        batchesUpdated++;
        resolvedCount += resolvedInBatch;
      }
    }
    if (resolvedCount > 0) {
      this.auditService.log(
        actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, originalStaffId,
        undefined, { resolvedCount, batchesUpdated },
      );
    }
    return { resolvedCount, batchesUpdated };
  }

  async dismissFlaggedEntry(batchId: string, index: number, actorId: string, actorName: string): Promise<ClaimImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, batchId);
    return batch;
  }

  async clearFlaggedEntries(batchId: string, actorId: string, actorName: string): Promise<ClaimImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    batch.flaggedEntries = [];
    batch.flaggedRows = 0;
    batch.status = ImportBatchStatus.Completed;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, batchId);
    return batch;
  }

  private async resolveOneEntry(
    batch: ClaimImportBatchDocument, entryIndex: number, resolvedStaffMongoId: string, actorName: string,
  ): Promise<void> {
    const entry = batch.flaggedEntries[entryIndex];
    if (entry.claimType && entry.month && entry.year) {
      await this.claimModel.create({
        staffId: resolvedStaffMongoId,
        claimType: entry.claimType,
        subReason: entry.subReason,
        month: entry.month,
        year: entry.year,
        amount: entry.amount,
        status: ClaimStatus.Approved,
        source: ClaimSource.LegacyImport,
        importBatchId: batch._id.toString(),
        recordedBy: actorName,
      });
      batch.matchedRows += 1;
    }
    batch.flaggedEntries.splice(entryIndex, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
  }
}
