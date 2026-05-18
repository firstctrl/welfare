import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ContributionsService } from './contributions.service';
import { Contribution } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionStatus, ContributionSource } from '@welfare/shared';

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockFind = jest.fn();
const mockCountDocuments = jest.fn();
const mockAggregate = jest.fn();

const mockContributionModel = {
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
  find: mockFind,
  countDocuments: mockCountDocuments,
  aggregate: mockAggregate,
};

const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({
    MONTHLY_CONTRIBUTION_AMOUNT: { value: '3000' },
    PENALTY_TYPE: { value: 'Percentage' },
    PENALTY_VALUE: { value: '5' },
  }),
};

const mockAuditService = { log: jest.fn() };

describe('ContributionsService', () => {
  let service: ContributionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionsService,
        { provide: getModelToken(Contribution.name), useValue: mockContributionModel },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get<ContributionsService>(ContributionsService);
    jest.clearAllMocks();
    mockConfigService.getAll.mockResolvedValue({
      MONTHLY_CONTRIBUTION_AMOUNT: { value: '3000' },
      PENALTY_TYPE: { value: 'Percentage' },
      PENALTY_VALUE: { value: '5' },
    });
  });

  describe('calculatePaymentResult (pure logic)', () => {
    it('marks Paid when totalCovered >= expectedAmount', () => {
      const result = service.calculatePaymentResult(0, 3000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('marks Partial when totalCovered < expectedAmount', () => {
      const result = service.calculatePaymentResult(0, 1000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Partial);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('calculates surplus when overpaid', () => {
      const result = service.calculatePaymentResult(0, 5000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(2000);
    });

    it('uses prevSurplus to reduce amount needed', () => {
      const result = service.calculatePaymentResult(0, 2500, 500, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('prevSurplus alone can cover full expected (no cash needed)', () => {
      const result = service.calculatePaymentResult(0, 0, 3500, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(500);
    });
  });

  describe('processPayment', () => {
    it('uses prevSurplus from previous month record', async () => {
      mockFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ surplusCarriedForward: 500 }) });
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      const result = await service.processPayment(
        'staff-mongo-id', 3, 2025, 2500, ContributionSource.PayrollImport, 'actor-id', 'Actor',
      );
      expect(result).toBe(savedDoc);
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { staffId: 'staff-mongo-id', month: 3, year: 2025 },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ContributionStatus.Paid,
            surplusCarriedForward: 0,
          }),
        }),
        expect.anything(),
      );
    });

    it('marks Partial when payment is insufficient', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      await service.processPayment('s1', 1, 2025, 1000, ContributionSource.ManualEntry, 'uid', 'U');
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: ContributionStatus.Partial }),
        }),
        expect.anything(),
      );
    });
  });

  describe('processLumpSum', () => {
    it('processes single month when amount covers only one month', async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const savedDoc = { _id: { toString: () => 'c-id' }, surplusCarriedForward: 0, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      const results = await service.processLumpSum('s1', 2500, 3, 2025, 'uid', 'U');
      expect(results).toHaveLength(1);
    });

    it('splits across multiple months when amount is large', async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { month: 1, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
          { month: 2, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
        ]),
      });
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const mockSaved = { _id: { toString: () => 'c-id' }, surplusCarriedForward: 0, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) });

      const results = await service.processLumpSum('s1', 6000, 1, 2025, 'uid', 'U');
      expect(results).toHaveLength(2);
      expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
