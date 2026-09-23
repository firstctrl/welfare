import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { LoansLegacyImportService } from './loans.legacy-import.service';
import { LoanLegacyImportBatch } from './schemas/loan-legacy-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };
const mockLoansService = { createForLegacyImport: jest.fn().mockResolvedValue({}) };
const mockStaffService = {
  findByStaffId: jest.fn((id: string) => Promise.resolve({ _id: { toString: () => `resolved-${id}` } })),
};
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

function twoSheetBuffer(
  loanRows: Record<string, unknown>[],
  instalmentRows: Record<string, unknown>[],
): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loanRows), 'Loans');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instalmentRows), 'Instalments');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const validLoanRow = {
  'Loan Ref': 'L1', 'Staff ID': 'S1', 'Guarantor Staff ID': 'S2',
  'Principal Amount': 6000, 'Tenure Months': 2, 'Disbursed Date': '15/12/2024',
  'Status': 'Active', 'Cutover Date': '01/01/2026',
  'Guarantor Restitution Owed': 0, 'Guarantor Restitution Paid': 0,
  'Cheque No': 'C1', 'PV No': 'PV1',
};
const validInstalmentRows = [
  { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': 3000, 'Paid Date': '04/01/2025', 'Status': 'Paid' },
  { 'Loan Ref': 'L1', 'Instalment Number': 2, 'Due Date': '05/02/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'Pending' },
];

describe('LoansLegacyImportService', () => {
  let service: LoansLegacyImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansLegacyImportService,
        { provide: getModelToken(LoanLegacyImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansLegacyImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });
  });

  it('creates a legacy loan from a valid loan row and its matching instalment rows', async () => {
    const buffer = twoSheetBuffer([validLoanRow], validInstalmentRows);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).toHaveBeenCalledWith(
      'resolved-S1',
      'resolved-S2',
      expect.objectContaining({ principalAmount: 6000, tenureMonths: 2, status: 'Active' }),
      expect.arrayContaining([
        expect.objectContaining({ instalmentNumber: 1, dueAmount: 3000, paidAmount: 3000 }),
        expect.objectContaining({ instalmentNumber: 2, dueAmount: 3000, paidAmount: 0 }),
      ]),
      'actor-1',
      'Actor',
    );
    expect(result).toEqual({ batchId: 'batch-1', created: 1, flagged: 0, total: 1 });
  });

  it('throws BadRequestException when the workbook is missing the Instalments sheet', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([validLoanRow]), 'Loans');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await expect(service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('flags the whole loan when an instalment row has an invalid Status, and does not create it', async () => {
    const badInstalments = [
      { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'NotAStatus' },
    ];
    const buffer = twoSheetBuffer([validLoanRow], badInstalments);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.flagged).toBe(1);
  });

  it('flags the loan when Staff ID is not found and does not call createForLegacyImport', async () => {
    mockStaffService.findByStaffId.mockImplementationOnce(() => Promise.resolve(null as any));
    const buffer = twoSheetBuffer([validLoanRow], validInstalmentRows);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).not.toHaveBeenCalled();
    expect(result.flagged).toBe(1);
  });

  it('flags the loan when two instalment rows share the same Instalment Number, and does not create it', async () => {
    const duplicateInstalments = [
      { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'Pending' },
      { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/02/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'Pending' },
    ];
    const buffer = twoSheetBuffer([validLoanRow], duplicateInstalments);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.flagged).toBe(1);
  });

  it('flags the loan when an instalment row has a negative Paid Amount, and does not create it', async () => {
    const badInstalments = [
      { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': -50, 'Status': 'Pending' },
    ];
    const buffer = twoSheetBuffer([validLoanRow], badInstalments);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.flagged).toBe(1);
  });

  it('flags an instalment row whose Loan Ref matches no loan row, without dropping it silently', async () => {
    const instalmentsWithOrphan = [
      ...validInstalmentRows,
      { 'Loan Ref': 'L2', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 1000, 'Paid Amount': 0, 'Status': 'Pending' },
    ];
    const buffer = twoSheetBuffer([validLoanRow], instalmentsWithOrphan);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(result.created).toBe(1);
    expect(result.flagged).toBe(1);
    const flaggedArg = mockFindByIdAndUpdate.mock.calls[0][1].$set.flaggedEntries;
    expect(flaggedArg[0]).toEqual(expect.objectContaining({ loanRef: 'L2' }));
  });

  it('flags both rows when two loan rows share the same Loan Ref, without creating either', async () => {
    const buffer = twoSheetBuffer([validLoanRow, { ...validLoanRow }], validInstalmentRows);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.flagged).toBe(2);
  });

  it('stores a finite principalAmount in the flagged entry when Principal Amount is non-numeric', async () => {
    const badLoanRow = { ...validLoanRow, 'Principal Amount': 'abc' };
    const buffer = twoSheetBuffer([badLoanRow], validInstalmentRows);

    await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    const flaggedArg = mockFindByIdAndUpdate.mock.calls[0][1].$set.flaggedEntries;
    expect(flaggedArg[0].principalAmount).toBe(0);
    expect(Number.isFinite(flaggedArg[0].principalAmount)).toBe(true);
  });
});
