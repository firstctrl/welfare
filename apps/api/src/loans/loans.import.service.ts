import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, LoanRepaymentStatus, LoanStatus, RepaymentSource } from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from './schemas/loan-repayment.schema';
import { Loan, LoanDocument } from './schemas/loan.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';

interface ImportRow {
  'Staff Name'?: string;
  'Staff ID'?: string;
  'Loan ID'?: string;
  Amount?: number;
  'Mode of Payment'?: string;
  'Paid Date'?: string;
}

export interface ImportRepaymentResult {
  total: number;
  processed: number;
  failed: { row: number; staffId: string; reason: string }[];
}

@Injectable()
export class LoansImportService {
  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name)
    private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    actorId: string,
    actorName: string,
  ): Promise<ImportRepaymentResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const failed: ImportRepaymentResult['failed'] = [];
    let processed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawStaffId = String(row['Staff ID'] ?? '').trim();
      const amount = Number(row.Amount ?? 0);
      const paidDateRaw = String(row['Paid Date'] ?? '').trim();
      const notes = String(row['Mode of Payment'] ?? '').trim() || undefined;

      if (!rawStaffId) {
        failed.push({ row: i + 2, staffId: '', reason: 'Missing Staff ID' });
        continue;
      }
      if (!(amount > 0)) {
        failed.push({ row: i + 2, staffId: rawStaffId, reason: 'Amount must be > 0' });
        continue;
      }

      let paidDate: string;
      if (paidDateRaw) {
        const d = new Date(paidDateRaw);
        if (isNaN(d.getTime())) {
          failed.push({ row: i + 2, staffId: rawStaffId, reason: 'Invalid Paid Date' });
          continue;
        }
        paidDate = d.toISOString();
      } else {
        paidDate = new Date().toISOString();
      }

      try {
        const staff = await this.staffService.findByStaffId(rawStaffId);
        if (!staff) {
          failed.push({ row: i + 2, staffId: rawStaffId, reason: 'Staff ID not found' });
          continue;
        }

        let loanId: string | undefined = row['Loan ID']
          ? String(row['Loan ID']).trim()
          : undefined;

        if (!loanId) {
          const activeLoan = await this.loanModel
            .findOne({ staffId: staff._id.toString(), status: LoanStatus.Active })
            .exec();
          if (!activeLoan) {
            failed.push({ row: i + 2, staffId: rawStaffId, reason: 'No active loan found' });
            continue;
          }
          loanId = activeLoan._id.toString();
        }

        await this.loansService.recordPaymentInternal(
          loanId,
          { amount, paidDate, notes },
          RepaymentSource.Import,
          actorId,
          actorName,
        );
        processed++;
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'Processing error';
        failed.push({ row: i + 2, staffId: rawStaffId, reason });
      }
    }

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Loan,
      'bulk-import',
      undefined,
      { total: rows.length, processed, failed: failed.length },
    );

    return { total: rows.length, processed, failed };
  }
}
