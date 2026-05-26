import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { RemittancesImportService } from './remittances.import.service';
import { RemittanceImportBatch } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';

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

describe('RemittancesImportService', () => {
  let service: RemittancesImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesImportService,
        { provide: getModelToken(RemittanceImportBatch.name), useValue: mockBatchModel },
        { provide: RemittancesService, useValue: mockRemittancesService },
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
