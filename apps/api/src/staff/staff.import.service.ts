import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, ImportBatchStatus, PaginatedResult } from '@welfare/shared';
import { StaffImportBatch, StaffImportBatchDocument } from './schemas/staff-import-batch.schema';
import { StaffService } from './staff.service';
import { AuditService } from '../audit/audit.service';

interface ImportRow {
  'Staff ID'?: string;
  'Full Name'?: string;
  'PF No'?: string;
  'Date of Birth'?: string;
  'Phone'?: string;
  'Email'?: string;
  'Date of Employment'?: string;
  'Date of First Contribution'?: string;
  'Level'?: string;
  'Point'?: number;
}

export interface StaffImportResult {
  batchId: string;
  created: number;
  flagged: number;
  total: number;
}

@Injectable()
export class StaffImportService {
  constructor(
    @InjectModel(StaffImportBatch.name)
    private readonly batchModel: Model<StaffImportBatchDocument>,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
  ): Promise<StaffImportResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });

    const flaggedEntries: StaffImportBatchDocument['flaggedEntries'] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const staffId    = String(row['Staff ID']    ?? '').trim();
      const fullName   = String(row['Full Name']   ?? '').trim();
      const pfNo       = String(row['PF No']       ?? '').trim() || undefined;
      const dob        = String(row['Date of Birth']            ?? '').trim();
      const phone      = String(row['Phone']                    ?? '').trim();
      const email      = String(row['Email']                    ?? '').trim();
      const dateOfEmp  = String(row['Date of Employment']       ?? '').trim();
      const dateOfFC   = String(row['Date of First Contribution'] ?? '').trim() || undefined;
      const level      = String(row['Level']       ?? '').trim() || undefined;
      const point      = row['Point'] !== undefined ? Number(row['Point']) : undefined;

      const flag = (reason: string) =>
        flaggedEntries.push({ rowNumber, staffId, fullName, reason });

      if (!staffId)  { flag('Missing Staff ID');  continue; }
      if (!fullName) { flag('Missing Full Name');  continue; }
      if (!dob)      { flag('Missing Date of Birth'); continue; }
      if (!phone)    { flag('Missing Phone');      continue; }
      if (!email)    { flag('Missing Email');      continue; }
      if (!dateOfEmp){ flag('Missing Date of Employment'); continue; }

      if (isNaN(new Date(dob).getTime()))     { flag('Invalid Date of Birth');       continue; }
      if (isNaN(new Date(dateOfEmp).getTime())){ flag('Invalid Date of Employment'); continue; }
      if (dateOfFC && isNaN(new Date(dateOfFC).getTime())) { flag('Invalid Date of First Contribution'); continue; }

      try {
        await this.staffService.create(
          { staffId, fullName, pfNo, dateOfBirth: dob, phoneNumber: phone, email, dateOfEmployment: dateOfEmp, dateOfFirstContribution: dateOfFC, level, point },
          actorId,
          actorName,
        );
        created++;
      } catch (err: unknown) {
        flag(err instanceof Error ? err.message : 'Processing error');
      }
    }

    const flagged = flaggedEntries.length;
    await this.batchModel.findByIdAndUpdate(batch._id, {
      $set: {
        matchedRows: created,
        flaggedRows: flagged,
        flaggedEntries,
        status: flagged === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending,
      },
    }).exec();

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Staff,
      batch._id.toString(),
      undefined,
      { total: rows.length, created, flagged },
    );

    return { batchId: batch._id.toString(), created, flagged, total: rows.length };
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<StaffImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<StaffImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }
}
