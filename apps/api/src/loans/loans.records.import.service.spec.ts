import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoansRecordsImportService } from './loans.records.import.service';
import { LoanRecordsImportBatch } from './schemas/loan-records-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

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
    const XLSX = require('xlsx');
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
