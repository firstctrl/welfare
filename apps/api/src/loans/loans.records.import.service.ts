import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, ImportBatchStatus, PaginatedResult } from '@welfare/shared';
import { LoanRecordsImportBatch, LoanRecordsImportBatchDocument } from './schemas/loan-records-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';

interface ImportRow {
  'Staff ID'?: string;
  'Guarantor Staff ID'?: string;
  'Principal Amount'?: number;
  'Tenure Months'?: number;
  'Disbursed Date'?: string;
  'Cheque No'?: string;
  'PV No'?: string;
}

export interface LoanRecordsImportResult {
  batchId: string;
  created: number;
  flagged: number;
  total: number;
}

@Injectable()
export class LoansRecordsImportService {
  constructor(
    @InjectModel(LoanRecordsImportBatch.name)
    private readonly batchModel: Model<LoanRecordsImportBatchDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
  ): Promise<LoanRecordsImportResult> {
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

    const flaggedEntries: LoanRecordsImportBatchDocument['flaggedEntries'] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const rawStaffId     = String(row['Staff ID']          ?? '').trim();
      const rawGuarantorId = String(row['Guarantor Staff ID'] ?? '').trim();
      const principalAmount = Number(row['Principal Amount'] ?? 0);
      const tenureMonths   = Number(row['Tenure Months']     ?? 0);
      const disbursedDateRaw = String(row['Disbursed Date']  ?? '').trim();
      const chequeNo       = String(row['Cheque No']         ?? '').trim();
      const pvNo           = String(row['PV No']             ?? '').trim();

      const flag = (reason: string) =>
        flaggedEntries.push({ rowNumber, staffId: rawStaffId, guarantorId: rawGuarantorId, principalAmount, disbursedDate: disbursedDateRaw, reason });

      if (!rawStaffId)      { flag('Missing Staff ID');       continue; }
      if (!rawGuarantorId)  { flag('Missing Guarantor Staff ID'); continue; }
      if (!(principalAmount > 0)) { flag('Principal Amount must be > 0'); continue; }
      if (!(tenureMonths >= 1 && tenureMonths <= 12)) { flag('Tenure Months must be 1–12'); continue; }
      if (!disbursedDateRaw){ flag('Missing Disbursed Date'); continue; }
      if (isNaN(new Date(disbursedDateRaw).getTime())) { flag('Invalid Disbursed Date'); continue; }
      if (!chequeNo)        { flag('Missing Cheque No');     continue; }
      if (!pvNo)            { flag('Missing PV No');         continue; }

      try {
        const staff = await this.staffService.findByStaffId(rawStaffId);
        if (!staff) { flag('Staff ID not found'); continue; }

        const guarantor = await this.staffService.findByStaffId(rawGuarantorId);
        if (!guarantor) { flag('Guarantor Staff ID not found'); continue; }

        await this.loansService.createForImport(
          staff._id.toString(),
          guarantor._id.toString(),
          { principalAmount, tenureMonths, disbursedDate: disbursedDateRaw, chequeNo, pvNo },
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
      AuditEntity.Loan,
      batch._id.toString(),
      undefined,
      { total: rows.length, created, flagged },
    );

    return { batchId: batch._id.toString(), created, flagged, total: rows.length };
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<LoanRecordsImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<LoanRecordsImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }
}
