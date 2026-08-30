import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ImportBatchStatus } from '@welfare/shared';
import { LoansRecordsImportService } from './loans.records.import.service';
import { LoanRecordsImportBatch } from './schemas/loan-records-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';
import * as XLSX from 'xlsx';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };
const mockLoansService = { createForImport: jest.fn().mockResolvedValue({}) };
const mockStaffService = {
  findByStaffId: jest.fn((id: string) => Promise.resolve({ _id: { toString: () => `resolved-${id}` } })),
};
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('LoansRecordsImportService — progress tracking', () => {
  let service: LoansRecordsImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansRecordsImportService,
        { provide: getModelToken(LoanRecordsImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansRecordsImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  });

  function excelBuffer(): Buffer {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Staff ID': 'S1', 'Guarantor Staff ID': 'S2', 'Principal Amount': 1000,
        'Tenure Months': 6, 'Disbursed Date': '01/03/2026', 'Cheque No': 'C1', 'PV No': 'PV1',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'records.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'records.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});

describe('LoansRecordsImportService — dismiss/delete', () => {
  let service: LoansRecordsImportService;
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansRecordsImportService,
        {
          provide: getModelToken(LoanRecordsImportBatch.name),
          useValue: {
            create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate,
            findById: mockFindById, findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansRecordsImportService);
    jest.clearAllMocks();
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 2,
      flaggedEntries: [
        { rowNumber: 2, staffId: 'S1', guarantorId: 'S2', principalAmount: 1000, disbursedDate: '2026-01-01', reason: 'Staff ID not found' },
        { rowNumber: 3, staffId: 'S3', guarantorId: 'S4', principalAmount: 2000, disbursedDate: '2026-01-01', reason: 'Staff ID not found' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedEntries).toHaveLength(1);
    expect(result.flaggedEntries[0].staffId).toBe('S3');
    expect(result.flaggedRows).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flaggedRows: 1, flaggedEntries: [{ rowNumber: 2, staffId: 'S1', guarantorId: 'S2', principalAmount: 1, disbursedDate: '', reason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('clearFlaggedEntries clears all flagged entries, marks Completed, and does not delete the batch', async () => {
    const batch: any = {
      _id: 'b1',
      flaggedRows: 1,
      flaggedEntries: [{ rowNumber: 2, staffId: 'S1', guarantorId: 'S2', principalAmount: 1, disbursedDate: '', reason: 'x' }],
      status: ImportBatchStatus.Pending,
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.clearFlaggedEntries('b1', 'actor-1', 'Actor');

    expect(result.flaggedEntries).toEqual([]);
    expect(result.flaggedRows).toBe(0);
    expect(result.status).toBe(ImportBatchStatus.Completed);
    expect(batch.save).toHaveBeenCalled();
    expect(mockFindByIdAndDelete).not.toHaveBeenCalled();
  });

  it('clearFlaggedEntries throws NotFoundException when batch is missing', async () => {
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.clearFlaggedEntries('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
