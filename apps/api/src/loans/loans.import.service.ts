import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  AuditAction,
  AuditEntity,
  ImportBatchStatus,
  LoanStatus,
  PaginatedResult,
  RepaymentSource,
} from '@welfare/shared';
import { Loan, LoanDocument } from './schemas/loan.schema';
import { LoanImportBatch, LoanImportBatchDocument } from './schemas/loan-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';

interface ImportRow {
  'Staff ID'?: string;
  'Staff Name'?: string;
  'Loan ID'?: string;
  Amount?: number;
  'Paid Date'?: string;
  Notes?: string;
}

export interface ImportRepaymentResult {
  batchId: string;
  matched: number;
  flagged: number;
  total: number;
}

@Injectable()
export class LoansImportService {
  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanImportBatch.name)
    private readonly batchModel: Model<LoanImportBatchDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
  ): Promise<ImportRepaymentResult> {
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

    const flaggedEntries: LoanImportBatchDocument['flaggedEntries'] = [];
    let matched = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const rawStaffId  = String(row['Staff ID']   ?? '').trim();
      const staffName   = String(row['Staff Name'] ?? '').trim();
      const rawLoanId   = String(row['Loan ID']    ?? '').trim();
      const amount      = Number(row.Amount ?? 0);
      const paidDateRaw = String(row['Paid Date']  ?? '').trim();
      const notes       = String(row.Notes        ?? '').trim() || undefined;

      const flag = (reason: string) =>
        flaggedEntries.push({ rowNumber, staffId: rawStaffId, staffName, loanId: rawLoanId, amount, paidDate: paidDateRaw, notes, reason });

      if (!rawStaffId) { flag('Missing Staff ID'); continue; }
      if (!(amount > 0)) { flag('Amount must be > 0'); continue; }

      let paidDate: string;
      if (paidDateRaw) {
        const d = new Date(paidDateRaw);
        if (isNaN(d.getTime())) { flag('Invalid Paid Date'); continue; }
        paidDate = d.toISOString();
      } else {
        paidDate = new Date().toISOString();
      }

      try {
        const staff = await this.staffService.findByStaffId(rawStaffId);
        if (!staff) { flag('Staff ID not found'); continue; }

        let loanId = rawLoanId || undefined;

        if (!loanId) {
          const activeLoan = await this.loanModel
            .findOne({ staffId: staff._id.toString(), status: LoanStatus.Active })
            .exec();
          if (!activeLoan) { flag('No active loan found for staff'); continue; }
          loanId = activeLoan._id.toString();
        }

        await this.loansService.recordPaymentInternal(
          loanId,
          { amount, paidDate, notes },
          RepaymentSource.Import,
          actorId,
          actorName,
        );
        matched++;
      } catch (err: unknown) {
        flag(err instanceof Error ? err.message : 'Processing error');
      }
    }

    const flagged = flaggedEntries.length;
    await this.batchModel.findByIdAndUpdate(batch._id, {
      $set: {
        matchedRows: matched,
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
      { total: rows.length, matched, flagged },
    );

    return { batchId: batch._id.toString(), matched, flagged, total: rows.length };
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<LoanImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<LoanImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async resolveFlagged(
    batchId: string,
    rowNumber: number,
    resolvedLoanId: string,
    actorId: string,
    actorName: string,
  ): Promise<LoanImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    const entryIdx = batch.flaggedEntries.findIndex((e) => e.rowNumber === rowNumber);
    if (entryIdx === -1) throw new NotFoundException(`Flagged entry row ${rowNumber} not found`);

    const entry = batch.flaggedEntries[entryIdx];
    const paidDate = entry.paidDate
      ? new Date(entry.paidDate).toISOString()
      : new Date().toISOString();

    await this.loansService.recordPaymentInternal(
      resolvedLoanId,
      { amount: entry.amount, paidDate, notes: entry.notes },
      RepaymentSource.Import,
      actorId,
      actorName,
    );

    batch.flaggedEntries.splice(entryIdx, 1);
    batch.matchedRows += 1;
    batch.flaggedRows  -= 1;
    batch.status = batch.flaggedRows === 0 ? ImportBatchStatus.Resolved : ImportBatchStatus.Pending;
    await batch.save();

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Update,
      AuditEntity.Loan,
      batchId,
      undefined,
      { resolvedRow: rowNumber, resolvedLoanId },
    );

    return batch;
  }
}
