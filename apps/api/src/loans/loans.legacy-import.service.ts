import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  AuditAction,
  AuditEntity,
  ImportBatchStatus,
  LoanRepaymentStatus,
  LoanStatus,
  PaginatedResult,
} from '@welfare/shared';
import { LoanLegacyImportBatch, LoanLegacyImportBatchDocument } from './schemas/loan-legacy-import-batch.schema';
import { LoansService, LegacyInstalmentInput } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { normalizeExcelDate } from '../common/utils/excel-date.util';
import { ImportProgressService } from '../common/import-progress.service';
import { ContributionsService } from '../contributions/contributions.service';

interface LoanRow {
  'Loan Ref'?: string;
  'Staff ID'?: string;
  'Guarantor Staff ID'?: string;
  'Principal Amount'?: number;
  'Tenure Months'?: number;
  'Disbursed Date'?: string | number | Date;
  'Status'?: string;
  'Cutover Date'?: string | number | Date;
  'Guarantor Restitution Owed'?: number;
  'Guarantor Restitution Paid'?: number;
  'Cheque No'?: string;
  'PV No'?: string;
  'Notes'?: string;
}

interface InstalmentRow {
  'Loan Ref'?: string;
  'Instalment Number'?: number;
  'Due Date'?: string | number | Date;
  'Due Amount'?: number;
  'Paid Amount'?: number;
  'Paid Date'?: string | number | Date;
  'Status'?: string;
}

export interface LoansLegacyImportResult {
  batchId: string;
  created: number;
  flagged: number;
  total: number;
}

@Injectable()
export class LoansLegacyImportService {
  constructor(
    @InjectModel(LoanLegacyImportBatch.name)
    private readonly batchModel: Model<LoanLegacyImportBatchDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
    private readonly contributionsService: ContributionsService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<LoansLegacyImportResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const loansSheet = workbook.Sheets['Loans'];
    const instalmentsSheet = workbook.Sheets['Instalments'];
    if (!loansSheet || !instalmentsSheet) {
      throw new BadRequestException('Workbook must contain a "Loans" sheet and an "Instalments" sheet');
    }

    const loanRows = XLSX.utils.sheet_to_json<LoanRow>(loansSheet);
    const instalmentRows = XLSX.utils.sheet_to_json<InstalmentRow>(instalmentsSheet);
    if (loanRows.length === 0) throw new BadRequestException('Loans sheet has no data rows');

    const instalmentsByRef = new Map<string, InstalmentRow[]>();
    for (const row of instalmentRows) {
      const ref = String(row['Loan Ref'] ?? '').trim();
      if (!ref) continue;
      const list = instalmentsByRef.get(ref) ?? [];
      list.push(row);
      instalmentsByRef.set(ref, list);
    }

    const loanRefCounts = new Map<string, number>();
    for (const row of loanRows) {
      const ref = String(row['Loan Ref'] ?? '').trim();
      if (!ref) continue;
      loanRefCounts.set(ref, (loanRefCounts.get(ref) ?? 0) + 1);
    }

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      uploadedBy: actorName,
      totalRows: loanRows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    const flaggedEntries: LoanLegacyImportBatchDocument['flaggedEntries'] = [];
    let created = 0;

    this.progressService.start(batchId, loanRows.length);
    try {
      for (let i = 0; i < loanRows.length; i++) {
        this.progressService.increment(batchId);

        const row = loanRows[i];
        const loanRef = String(row['Loan Ref'] ?? '').trim();
        const rawStaffId = String(row['Staff ID'] ?? '').trim();
        const rawGuarantorId = String(row['Guarantor Staff ID'] ?? '').trim();
        const principalAmount = Number(row['Principal Amount'] ?? 0);
        const tenureMonths = Number(row['Tenure Months'] ?? 0);
        const disbursedDateRaw = normalizeExcelDate(row['Disbursed Date']);
        const cutoverDateRaw = normalizeExcelDate(row['Cutover Date']);
        const status = String(row['Status'] ?? '').trim();
        const guarantorRestitutionOwed = Number(row['Guarantor Restitution Owed'] ?? 0);
        const guarantorRestitutionPaid = Number(row['Guarantor Restitution Paid'] ?? 0);
        const chequeNo = String(row['Cheque No'] ?? '').trim();
        const pvNo = String(row['PV No'] ?? '').trim();
        const notes = String(row['Notes'] ?? '').trim() || undefined;

        const flag = (reason: string) =>
          flaggedEntries.push({
            loanRef, staffId: rawStaffId, guarantorId: rawGuarantorId,
            principalAmount: Number.isFinite(principalAmount) ? principalAmount : 0,
            disbursedDate: disbursedDateRaw, reason,
          });

        if (!loanRef) { flag('Missing Loan Ref'); continue; }
        if ((loanRefCounts.get(loanRef) ?? 0) > 1) { flag('Duplicate Loan Ref'); continue; }
        if (!rawStaffId) { flag('Missing Staff ID'); continue; }
        if (!rawGuarantorId) { flag('Missing Guarantor Staff ID'); continue; }
        if (!(principalAmount > 0)) { flag('Principal Amount must be > 0'); continue; }
        if (!(tenureMonths >= 1)) { flag('Tenure Months must be >= 1'); continue; }
        if (!disbursedDateRaw || isNaN(new Date(disbursedDateRaw).getTime())) { flag('Missing or invalid Disbursed Date'); continue; }
        if (!Object.values(LoanStatus).includes(status as LoanStatus)) { flag(`Invalid Status "${status}"`); continue; }
        if (!cutoverDateRaw || isNaN(new Date(cutoverDateRaw).getTime())) { flag('Missing or invalid Cutover Date'); continue; }

        const rows = instalmentsByRef.get(loanRef) ?? [];
        if (rows.length === 0) { flag('No instalment rows found for this Loan Ref'); continue; }

        const instalments: LegacyInstalmentInput[] = [];
        const seenInstalmentNumbers = new Set<number>();
        let instalmentError: string | undefined;
        for (const instRow of rows) {
          const instalmentNumber = Number(instRow['Instalment Number'] ?? 0);
          const dueDateRaw = normalizeExcelDate(instRow['Due Date']);
          const dueAmount = Number(instRow['Due Amount'] ?? 0);
          const paidAmount = Number(instRow['Paid Amount'] ?? 0);
          const paidDateRaw = normalizeExcelDate(instRow['Paid Date']);
          const instStatus = String(instRow['Status'] ?? '').trim();

          if (!(instalmentNumber >= 1)) { instalmentError = `Instalment ${instalmentNumber}: Instalment Number must be >= 1`; break; }
          if (seenInstalmentNumbers.has(instalmentNumber)) { instalmentError = `Instalment ${instalmentNumber}: duplicate Instalment Number`; break; }
          seenInstalmentNumbers.add(instalmentNumber);
          if (!dueDateRaw || isNaN(new Date(dueDateRaw).getTime())) { instalmentError = `Instalment ${instalmentNumber}: missing or invalid Due Date`; break; }
          if (!(dueAmount > 0)) { instalmentError = `Instalment ${instalmentNumber}: Due Amount must be > 0`; break; }
          if (!(Number.isFinite(paidAmount) && paidAmount >= 0)) { instalmentError = `Instalment ${instalmentNumber}: Paid Amount must be a number >= 0`; break; }
          if (!Object.values(LoanRepaymentStatus).includes(instStatus as LoanRepaymentStatus)) {
            instalmentError = `Instalment ${instalmentNumber}: invalid Status "${instStatus}"`; break;
          }
          if ((instStatus === LoanRepaymentStatus.Paid || instStatus === LoanRepaymentStatus.Partial) && !paidDateRaw) {
            instalmentError = `Instalment ${instalmentNumber}: Paid Date required when Status is ${instStatus}`; break;
          }

          instalments.push({
            instalmentNumber,
            dueDate: new Date(dueDateRaw),
            dueAmount,
            paidAmount,
            paidDate: paidDateRaw ? new Date(paidDateRaw) : undefined,
            status: instStatus as LoanRepaymentStatus,
          });
        }
        if (instalmentError) { flag(instalmentError); continue; }

        try {
          const staff = await this.staffService.findByStaffId(rawStaffId);
          if (!staff) { flag('Staff ID not found'); continue; }
          const guarantor = await this.staffService.findByStaffId(rawGuarantorId);
          if (!guarantor) { flag('Guarantor Staff ID not found'); continue; }

          await this.loansService.createForLegacyImport(
            staff._id.toString(),
            guarantor._id.toString(),
            {
              principalAmount, tenureMonths, disbursedDate: disbursedDateRaw,
              status: status as LoanStatus, cutoverDate: cutoverDateRaw,
              guarantorRestitutionOwed, guarantorRestitutionPaid, chequeNo, pvNo, notes,
            },
            instalments,
            actorId,
            actorName,
          );
          created++;

          if (guarantorRestitutionOwed > 0) {
            try {
              const paidDates = instalments
                .map((inst) => inst.paidDate)
                .filter((d): d is Date => d !== undefined && !isNaN(d.getTime()));
              if (paidDates.length > 0) {
                const asOfDate = new Date(Math.max(...paidDates.map((d) => d.getTime())));
                const defaulterBalance = await this.contributionsService.getBalanceAsOfPeriod(
                  staff._id.toString(),
                  asOfDate.getMonth() + 1,
                  asOfDate.getFullYear(),
                );
                if (defaulterBalance > 0) {
                  flag(
                    `LOAN WAS IMPORTED — Guarantor Restitution Owed may not reflect defaulter-first order — defaulter had ${defaulterBalance.toFixed(2)} available at the time. This is a warning, not a failure; do not re-upload this row.`,
                  );
                }
              }
            } catch (err: unknown) {
              flag(
                `LOAN WAS IMPORTED — restitution cross-check failed: ${err instanceof Error ? err.message : 'Unknown error'}. Do not re-upload this row; verify manually.`,
              );
            }
          }
        } catch (err: unknown) {
          flag(err instanceof Error ? err.message : 'Processing error');
        }
      }
      const knownLoanRefs = new Set(
        loanRows.map((r) => String(r['Loan Ref'] ?? '').trim()).filter(Boolean),
      );
      for (const ref of instalmentsByRef.keys()) {
        if (!knownLoanRefs.has(ref)) {
          flaggedEntries.push({
            loanRef: ref, staffId: '', guarantorId: '', principalAmount: 0,
            disbursedDate: '', reason: 'Instalment rows reference unknown Loan Ref',
          });
        }
      }
    } finally {
      this.progressService.complete(batchId);
    }

    const flagged = flaggedEntries.length;
    await this.batchModel.findByIdAndUpdate(batchId, {
      $set: {
        matchedRows: created,
        flaggedRows: flagged,
        flaggedEntries,
        status: flagged === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending,
      },
    }).exec();

    this.auditService.log(
      actorId, actorName, AuditAction.Import, AuditEntity.Loan, batchId,
      undefined, { total: loanRows.length, created, flagged },
    );

    return { batchId, created, flagged, total: loanRows.length };
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<LoanLegacyImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<LoanLegacyImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<LoanLegacyImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, batchId);
    return batch;
  }

  async clearFlaggedEntries(batchId: string, actorId: string, actorName: string): Promise<LoanLegacyImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    batch.flaggedEntries = [];
    batch.flaggedRows = 0;
    batch.status = ImportBatchStatus.Completed;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, batchId);
    return batch;
  }
}
