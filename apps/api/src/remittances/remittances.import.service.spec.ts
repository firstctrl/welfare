import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { RemittancesImportService } from './remittances.import.service';
import { RemittanceImportBatch } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';
import { ImportProgressService } from '../common/import-progress.service';
import { AuditService } from '../audit/audit.service';

function makeBuffer(rows: object[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const mockBatchModel = {
  create: jest.fn().mockResolvedValue({ _id: 'batch1' }),
  updateOne: jest.fn().mockResolvedValue({}),
};
const mockRemittancesService = {
  create: jest.fn(),
};
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };
const mockAuditService = { log: jest.fn() };

describe('RemittancesImportService', () => {
  let service: RemittancesImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesImportService,
        { provide: getModelToken(RemittanceImportBatch.name), useValue: mockBatchModel },
        { provide: RemittancesService, useValue: mockRemittancesService },
        { provide: ImportProgressService, useValue: mockProgressService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get<RemittancesImportService>(RemittancesImportService);
    jest.clearAllMocks();
    mockBatchModel.create.mockResolvedValue({ _id: 'batch1' });
    mockBatchModel.updateOne.mockResolvedValue({});
  });

  it('throws BadRequestException on empty file', async () => {
    const buf = makeBuffer([]);
    await expect(service.processImport(buf, 'test.xlsx', 'uid', 'User')).rejects.toThrow(BadRequestException);
  });

  it('flags duplicate period (ConflictException from service)', async () => {
    mockRemittancesService.create.mockRejectedValue({ status: 409, message: 'already exists' });
    const buf = makeBuffer([{ Month: 1, Year: 2025, 'Receipt Date': '31/01/2025' }]);
    const result = await service.processImport(buf, 'test.xlsx', 'uid', 'User');
    expect(result.flagged).toBe(1);
    expect(result.imported).toBe(0);
    expect(mockBatchModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ flagged: 1 }),
    );
  });

  it('imports valid rows and counts correctly', async () => {
    mockRemittancesService.create.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const rows = [
      { Month: 1, Year: 2025, 'Receipt Date': '31/01/2025' },
      { Month: 2, Year: 2025, 'Receipt Date': '28/02/2025' },
    ];
    const result = await service.processImport(makeBuffer(rows), 'test.xlsx', 'uid', 'User');
    expect(result.imported).toBe(2);
    expect(result.flagged).toBe(0);
  });

  it('flags rows with invalid Month', async () => {
    const buf = makeBuffer([{ Month: 13, Year: 2025, 'Receipt Date': '31/01/2025' }]);
    const result = await service.processImport(buf, 'test.xlsx', 'uid', 'User');
    expect(result.flagged).toBe(1);
    expect(mockRemittancesService.create).not.toHaveBeenCalled();
  });
});

describe('RemittancesImportService — progress tracking', () => {
  let service: RemittancesImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesImportService,
        { provide: getModelToken(RemittanceImportBatch.name), useValue: mockBatchModel },
        { provide: RemittancesService, useValue: mockRemittancesService },
        { provide: ImportProgressService, useValue: mockProgressService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(RemittancesImportService);
    jest.clearAllMocks();
    mockBatchModel.updateOne.mockResolvedValue(undefined);
  });

  function excelBuffer(): Buffer {
    const ws = XLSX.utils.json_to_sheet([
      { Month: 1, Year: 2026, 'Receipt Date': '05/01/2026' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockBatchModel.create.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'rem.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockBatchModel.create.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'rem.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockBatchModel.create.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});

describe('RemittancesImportService — list/get/dismiss/delete', () => {
  let service: RemittancesImportService;
  const mockFind = jest.fn();
  const mockCountDocuments = jest.fn();
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesImportService,
        {
          provide: getModelToken(RemittanceImportBatch.name),
          useValue: {
            create: mockBatchModel.create,
            updateOne: mockBatchModel.updateOne,
            find: mockFind,
            countDocuments: mockCountDocuments,
            findById: mockFindById,
            findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: RemittancesService, useValue: mockRemittancesService },
        { provide: ImportProgressService, useValue: mockProgressService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(RemittancesImportService);
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
        { rowNumber: 2, month: 1, year: 2026, flagReason: 'Duplicate period' },
        { rowNumber: 3, month: 2, year: 2026, flagReason: 'Duplicate period' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedRows).toEqual([{ rowNumber: 3, month: 2, year: 2026, flagReason: 'Duplicate period' }]);
    expect(result.flagged).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flagged: 1, flaggedRows: [{ rowNumber: 2, month: 1, year: 2026, flagReason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('clearFlaggedEntries clears all flagged rows without deleting the batch', async () => {
    const batch: any = {
      _id: 'b1',
      flagged: 2,
      flaggedRows: [
        { rowNumber: 2, month: 1, year: 2026, flagReason: 'Duplicate period' },
        { rowNumber: 3, month: 2, year: 2026, flagReason: 'Duplicate period' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.clearFlaggedEntries('b1', 'actor-1', 'Actor');

    expect(result.flaggedRows).toEqual([]);
    expect(result.flagged).toBe(0);
    expect(batch.save).toHaveBeenCalled();
    expect(mockFindByIdAndDelete).not.toHaveBeenCalled();
  });

  it('clearFlaggedEntries throws NotFoundException when batch is missing', async () => {
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.clearFlaggedEntries('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
