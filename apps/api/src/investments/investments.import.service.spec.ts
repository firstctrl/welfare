import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { InvestmentsImportService } from './investments.import.service';
import { InvestmentImportBatch } from './schemas/investment-import-batch.schema';
import { InvestmentsService } from './investments.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockUpdateOne = jest.fn();
const mockBatchModel = { create: mockCreate, updateOne: mockUpdateOne };
const mockInvestmentsService = { create: jest.fn().mockResolvedValue({}) };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('InvestmentsImportService — progress tracking', () => {
  let service: InvestmentsImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsImportService,
        { provide: getModelToken(InvestmentImportBatch.name), useValue: mockBatchModel },
        { provide: InvestmentsService, useValue: mockInvestmentsService },
        { provide: ImportProgressService, useValue: mockProgressService },
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
