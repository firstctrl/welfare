import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ImportBatchStatus } from '@welfare/shared';
import { LoansImportService } from './loans.import.service';
import { Loan } from './schemas/loan.schema';
import { LoanImportBatch } from './schemas/loan-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockFind = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: mockFind };
const mockLoanModel = { findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' } }) }) };
const mockLoansService = { recordPaymentInternal: jest.fn().mockResolvedValue(undefined) };
const mockStaffService = { findByStaffId: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' } }) };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('LoansImportService — progress tracking', () => {
  let service: LoansImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansImportService,
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: getModelToken(LoanImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { 'Staff ID': 'S1', Amount: 500, 'Paid Date': '01/03/2026' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'loans.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'loans.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});

describe('LoansImportService — resolveByStaffId', () => {
  let service: LoansImportService;

  function makeBatch(flaggedEntries: any[] = []) {
    return {
      _id: 'batch-x',
      status: 'Pending',
      matchedRows: 0,
      flaggedRows: flaggedEntries.length,
      flaggedEntries,
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansImportService,
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: getModelToken(LoanImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansImportService);
    jest.clearAllMocks();
  });

  it('resolves the matching flagged entry in every pending batch, applying the same loan to each', async () => {
    const batchA = makeBatch([{ rowNumber: 2, staffId: 'S1', staffName: 'Jane', loanId: '', amount: 300, paidDate: '2026-01-01T00:00:00.000Z', reason: 'Staff ID not found' }]);
    const batchB = makeBatch([{ rowNumber: 2, staffId: 'S1', staffName: 'Jane', loanId: '', amount: 350, paidDate: '2026-02-01T00:00:00.000Z', reason: 'Staff ID not found' }]);
    mockFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([batchA, batchB]) });

    const result = await service.resolveByStaffId('S1', 'loan-mongo-id', 'actor-1', 'Actor');

    expect(result).toEqual({ resolvedCount: 2, batchesUpdated: 2 });
    expect(mockLoansService.recordPaymentInternal).toHaveBeenCalledTimes(2);
    expect(mockLoansService.recordPaymentInternal).toHaveBeenCalledWith(
      'loan-mongo-id', expect.objectContaining({ amount: 300 }), expect.anything(), 'actor-1', 'Actor',
    );
    expect(batchA.flaggedEntries).toHaveLength(0);
    expect(batchB.flaggedEntries).toHaveLength(0);
  });

  it('returns zero counts when no batch has a matching staffId', async () => {
    mockFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    const result = await service.resolveByStaffId('S1', 'loan-mongo-id', 'actor-1', 'Actor');

    expect(result).toEqual({ resolvedCount: 0, batchesUpdated: 0 });
    expect(mockLoansService.recordPaymentInternal).not.toHaveBeenCalled();
  });
});

describe('LoansImportService — dismiss/delete', () => {
  let service: LoansImportService;
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansImportService,
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        {
          provide: getModelToken(LoanImportBatch.name),
          useValue: {
            create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: mockFind,
            findById: mockFindById, findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansImportService);
    jest.clearAllMocks();
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 2,
      flaggedEntries: [
        { rowNumber: 2, staffId: 'S1', staffName: 'A', loanId: '', amount: 100, paidDate: '2026-01-01T00:00:00.000Z', reason: 'Staff ID not found' },
        { rowNumber: 3, staffId: 'S2', staffName: 'B', loanId: '', amount: 200, paidDate: '2026-01-01T00:00:00.000Z', reason: 'Staff ID not found' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedEntries).toHaveLength(1);
    expect(result.flaggedEntries[0].staffId).toBe('S2');
    expect(result.flaggedRows).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flaggedRows: 1, flaggedEntries: [{ rowNumber: 2, staffId: 'S1', staffName: 'A', loanId: '', amount: 1, paidDate: '', reason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('clearFlaggedEntries clears all flagged entries, marks Resolved, and does not delete the batch', async () => {
    const batch: any = {
      _id: 'b1',
      flaggedRows: 1,
      flaggedEntries: [{ rowNumber: 2, staffId: 'S1', staffName: 'A', loanId: '', amount: 1, paidDate: '', reason: 'x' }],
      status: ImportBatchStatus.Pending,
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.clearFlaggedEntries('b1', 'actor-1', 'Actor');

    expect(result.flaggedEntries).toEqual([]);
    expect(result.flaggedRows).toBe(0);
    expect(result.status).toBe(ImportBatchStatus.Resolved);
    expect(batch.save).toHaveBeenCalled();
    expect(mockFindByIdAndDelete).not.toHaveBeenCalled();
  });

  it('clearFlaggedEntries throws NotFoundException when batch is missing', async () => {
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.clearFlaggedEntries('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
