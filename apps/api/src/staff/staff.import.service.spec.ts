import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StaffImportService } from './staff.import.service';
import { StaffImportBatch } from './schemas/staff-import-batch.schema';
import { StaffService } from './staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };
const mockStaffService = { create: jest.fn().mockResolvedValue({}) };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('StaffImportService — progress tracking', () => {
  let service: StaffImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffImportService,
        { provide: getModelToken(StaffImportBatch.name), useValue: mockBatchModel },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(StaffImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      {
        'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Date of Birth': '01/01/1990',
        Phone: '0555555555', Email: 'jane@example.com', 'Date of Employment': '01/02/2020',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'staff.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'staff.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});

describe('StaffImportService — dismiss/delete', () => {
  let service: StaffImportService;
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffImportService,
        {
          provide: getModelToken(StaffImportBatch.name),
          useValue: { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, findById: mockFindById, findByIdAndDelete: mockFindByIdAndDelete },
        },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(StaffImportService);
    jest.clearAllMocks();
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count, recomputing status', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 2,
      flaggedEntries: [
        { rowNumber: 2, staffId: 'S1', fullName: 'A', reason: 'Missing Email' },
        { rowNumber: 3, staffId: 'S2', fullName: 'B', reason: 'Missing Email' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedEntries).toEqual([{ rowNumber: 3, staffId: 'S2', fullName: 'B', reason: 'Missing Email' }]);
    expect(result.flaggedRows).toBe(1);
    expect(result.status).toBe('Pending');
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry marks the batch Completed once the last flagged entry is cleared', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 1,
      flaggedEntries: [{ rowNumber: 2, staffId: 'S1', fullName: 'A', reason: 'Missing Email' }],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.status).toBe('Completed');
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flaggedRows: 1, flaggedEntries: [{ rowNumber: 2, staffId: 'S1', fullName: 'A', reason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('deleteBatch deletes and throws NotFoundException when missing', async () => {
    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'b1' }) });
    await expect(service.deleteBatch('b1', 'actor-1', 'Actor')).resolves.toBeUndefined();

    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteBatch('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
