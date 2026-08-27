import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { InvestmentsImportService } from './investments.import.service';
import { InvestmentImportBatch } from './schemas/investment-import-batch.schema';
import { InvestmentsService } from './investments.service';
import { ImportProgressService } from '../common/import-progress.service';
import { AuditService } from '../audit/audit.service';

const mockCreate = jest.fn();
const mockUpdateOne = jest.fn();
const mockBatchModel = { create: mockCreate, updateOne: mockUpdateOne };
const mockInvestmentsService = { create: jest.fn().mockResolvedValue({}) };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };
const mockAuditService = { log: jest.fn() };

describe('InvestmentsImportService — progress tracking', () => {
  let service: InvestmentsImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsImportService,
        { provide: getModelToken(InvestmentImportBatch.name), useValue: mockBatchModel },
        { provide: InvestmentsService, useValue: mockInvestmentsService },
        { provide: ImportProgressService, useValue: mockProgressService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(InvestmentsImportService);
    jest.clearAllMocks();
    mockUpdateOne.mockResolvedValue(undefined);
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      {
        'Purchase Date': '01/01/2026', Description: 'T-Bill', Cost: 1000,
        'Maturity Date': '01/04/2026', 'Face Value': 1050, Instruction: 'One-Time',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'inv.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'inv.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});

describe('InvestmentsImportService — list/get/dismiss/delete', () => {
  let service: InvestmentsImportService;
  const mockFind = jest.fn();
  const mockCountDocuments = jest.fn();
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsImportService,
        {
          provide: getModelToken(InvestmentImportBatch.name),
          useValue: {
            create: mockCreate,
            updateOne: mockUpdateOne,
            find: mockFind,
            countDocuments: mockCountDocuments,
            findById: mockFindById,
            findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: InvestmentsService, useValue: mockInvestmentsService },
        { provide: ImportProgressService, useValue: mockProgressService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(InvestmentsImportService);
    jest.clearAllMocks();
  });

  it('listBatches paginates newest-first', async () => {
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ _id: 'b1' }]),
    });
    mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

    const result = await service.listBatches(1, 20);

    expect(result).toEqual({ data: [{ _id: 'b1' }], total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it('getBatch throws NotFoundException when missing', async () => {
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.getBatch('missing')).rejects.toThrow('Import batch missing not found');
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      flagged: 2,
      flaggedRows: [
        { rowNumber: 2, description: 'A', flagReason: 'Missing Cost' },
        { rowNumber: 3, description: 'B', flagReason: 'Missing Cost' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedRows).toEqual([{ rowNumber: 3, description: 'B', flagReason: 'Missing Cost' }]);
    expect(result.flagged).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flagged: 1, flaggedRows: [{ rowNumber: 2, description: 'A', flagReason: 'x' }], save: jest.fn() };
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
