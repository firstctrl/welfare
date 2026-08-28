import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ContributionRatesService } from './contribution-rates.service';
import { ContributionRate } from './schemas/contribution-rate.schema';
import { Contribution } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';

const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockCountDocuments = jest.fn();
const mockCreate = jest.fn();
const mockFindByIdAndDelete = jest.fn();
const mockRateModel = {
  findOne: mockFindOne,
  find: mockFind,
  countDocuments: mockCountDocuments,
  create: mockCreate,
  findByIdAndDelete: mockFindByIdAndDelete,
};

const mockContribFind = jest.fn();
const mockContributionModel = { find: mockContribFind };

const mockConfigService = { getAll: jest.fn() };
const mockAuditService = { log: jest.fn() };

describe('ContributionRatesService', () => {
  let service: ContributionRatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionRatesService,
        { provide: getModelToken(ContributionRate.name), useValue: mockRateModel },
        { provide: getModelToken(Contribution.name), useValue: mockContributionModel },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(ContributionRatesService);
    jest.clearAllMocks();
  });

  describe('getRateFor', () => {
    it('returns the amount of the latest rate at or before the target period', async () => {
      mockFindOne.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ amount: 3500 }),
      });

      const amount = await service.getRateFor(6, 2024);

      expect(amount).toBe(3500);
      expect(mockFindOne).toHaveBeenCalledWith({ effectiveKey: { $lte: 2024 * 12 + 6 } });
    });

    it('throws BadRequestException when no rate covers the period', async () => {
      mockFindOne.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getRateFor(1, 2019)).rejects.toThrow('No contribution rate defined for 1/2019');
    });
  });

  describe('create', () => {
    it('creates a rate with a computed effectiveKey', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const created = { _id: { toString: () => 'r1' }, month: 7, year: 2024, amount: 3500 };
      mockCreate.mockResolvedValue(created);

      const result = await service.create({ month: 7, year: 2024, amount: 3500 }, 'actor-1', 'Actor');

      expect(result).toBe(created);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ month: 7, year: 2024, amount: 3500, effectiveKey: 2024 * 12 + 7, createdBy: 'Actor' }),
      );
    });

    it('throws ConflictException when a rate already exists for that period', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'existing' }) });

      await expect(service.create({ month: 7, year: 2024, amount: 3500 }, 'actor-1', 'Actor'))
        .rejects.toThrow('A rate already exists for 7/2024');
    });
  });

  describe('delete', () => {
    it('deletes when more than one rate remains', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });
      mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'r1', toObject: () => ({}) }) });

      await expect(service.delete('r1', 'actor-1', 'Actor')).resolves.toBeUndefined();
    });

    it('throws ConflictException when deleting the only remaining rate', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      await expect(service.delete('r1', 'actor-1', 'Actor')).rejects.toThrow('Cannot delete the only remaining contribution rate');
    });

    it('throws NotFoundException when the rate does not exist', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });
      mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.delete('missing', 'actor-1', 'Actor')).rejects.toThrow('Contribution rate missing not found');
    });
  });

  describe('list', () => {
    it('returns rates sorted newest-first', async () => {
      mockFind.mockReturnValue({ sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([{ month: 7, year: 2024 }]) });

      const result = await service.list();

      expect(result).toEqual([{ month: 7, year: 2024 }]);
    });
  });

  describe('onModuleInit (migration seed)', () => {
    it('seeds from the current config value and the earliest contribution period when the collection is empty', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      mockConfigService.getAll.mockResolvedValue({ MONTHLY_CONTRIBUTION_AMOUNT: { value: '3000' } });
      mockContribFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([{ month: 3, year: 2022 }]),
      });
      mockCreate.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ month: 3, year: 2022, amount: 3000, effectiveKey: 2022 * 12 + 3, createdBy: 'system-migration' }),
      );
    });

    it('falls back to amount 100 and the current month/year when config and contributions are both empty', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      mockConfigService.getAll.mockResolvedValue({});
      mockContribFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      mockCreate.mockResolvedValue({});

      await service.onModuleInit();

      const now = new Date();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100, month: now.getMonth() + 1, year: now.getFullYear(), createdBy: 'system-migration' }),
      );
    });

    it('does nothing when the collection already has entries', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      await service.onModuleInit();

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
