import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException } from '@nestjs/common';
import { RemittancesService } from './remittances.service';
import { Remittance } from './schemas/remittance.schema';
import { Contribution } from '../contributions/schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';

const mockRemittanceModel = {
  findOne: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};
const mockContribModel = { aggregate: jest.fn() };
const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({ REMITTANCE_CHARGE_RATE: { value: '3' } }),
};

describe('RemittancesService', () => {
  let service: RemittancesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesService,
        { provide: getModelToken(Remittance.name), useValue: mockRemittanceModel },
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: SystemConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<RemittancesService>(RemittancesService);
    jest.clearAllMocks();
    mockConfigService.getAll.mockResolvedValue({ REMITTANCE_CHARGE_RATE: { value: '3' } });
  });

  describe('getGrossForPeriod', () => {
    it('returns 0 when no contributions', async () => {
      mockContribModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      expect(await service.getGrossForPeriod(1, 2025)).toBe(0);
    });

    it('sums paidAmount from aggregate', async () => {
      mockContribModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ total: 12000 }]) });
      expect(await service.getGrossForPeriod(1, 2025)).toBe(12000);
    });
  });

  describe('getGrossPreview', () => {
    it('computes 3% charges and netPayable', async () => {
      jest.spyOn(service, 'getGrossForPeriod').mockResolvedValue(10000);
      const result = await service.getGrossPreview(1, 2025);
      expect(result).toEqual({ grossAmount: 10000, charges: 300, netPayable: 9700 });
    });
  });

  describe('create', () => {
    it('throws ConflictException when period already recorded', async () => {
      mockRemittanceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ month: 1, year: 2025 }) });
      await expect(service.create({ month: 1, year: 2025, receiptDate: '2025-01-31' }, 'uid')).rejects.toThrow(ConflictException);
    });

    it('creates record with snapshotted values', async () => {
      mockRemittanceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      jest.spyOn(service, 'getGrossForPeriod').mockResolvedValue(10000);
      mockRemittanceModel.create.mockResolvedValue({ _id: 'r1', month: 1, year: 2025 });
      await service.create({ month: 1, year: 2025, receiptDate: '2025-01-31' }, 'uid');
      expect(mockRemittanceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ grossAmount: 10000, charges: 300, netPayable: 9700, chargeRate: 3 }),
      );
    });
  });

  describe('getReport', () => {
    it('returns totals summed from rows', async () => {
      const records = [
        { month: 1, year: 2025, receiptDate: new Date('2025-01-31'), grossAmount: 10000, charges: 300, netPayable: 9700 },
        { month: 2, year: 2025, receiptDate: new Date('2025-02-28'), grossAmount: 8000, charges: 240, netPayable: 7760 },
      ];
      mockRemittanceModel.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(records) }) });
      const result = await service.getReport(1, 2025, 2, 2025);
      expect(result.totalGross).toBe(18000);
      expect(result.totalCharges).toBe(540);
      expect(result.totalNet).toBe(17460);
      expect(result.rows).toHaveLength(2);
    });
  });
});
