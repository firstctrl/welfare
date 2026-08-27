import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ImportService } from './import.service';
import { ImportBatch } from './schemas/import-batch.schema';
import { ContributionsService } from './contributions.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };

const mockContributionsService = { processPayment: jest.fn().mockResolvedValue(undefined) };
const mockStaffService = { findByStaffId: jest.fn() };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('ImportService (contributions) — progress tracking', () => {
  let service: ImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: getModelToken(ImportBatch.name), useValue: mockBatchModel },
        { provide: ContributionsService, useValue: mockContributionsService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(ImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-1' } });
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { 'Staff ID': 'S1', 'Employee Name': 'Jane', Month: 1, Year: 2026, Amount: 100 },
      { 'Staff ID': 'S2', 'Employee Name': 'Joe', Month: 1, Year: 2026, Amount: 200 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'test.xlsx', undefined, undefined, 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 2);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(2);
    expect(mockProgressService.increment).toHaveBeenCalledWith('batch-1');
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(
      excelBuffer(), 'test.xlsx', undefined, undefined, 'actor-1', 'Actor', '507f1f77bcf86cd799439011',
    );

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });

  it('completes progress even when a row throws', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-2' } });
    mockContributionsService.processPayment.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.processImport(excelBuffer(), 'test.xlsx', undefined, undefined, 'actor-1', 'Actor'),
    ).rejects.toThrow('boom');

    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-2');
  });
});
