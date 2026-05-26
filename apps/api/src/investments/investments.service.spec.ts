import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { Investment } from './schemas/investment.schema';

const mockModel = {
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  updateOne: jest.fn(),
};

describe('InvestmentsService', () => {
  let service: InvestmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsService,
        { provide: getModelToken(Investment.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<InvestmentsService>(InvestmentsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('computes interest and rate before saving', async () => {
      mockModel.create.mockResolvedValue({ _id: 'inv1' });
      await service.create(
        { purchaseDate: '2025-01-01', description: 'T-Bill', cost: 10000, maturityDate: '2025-07-01', faceValue: 10500, instruction: 'One-Time' },
        'uid',
      );
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ interest: 500, rate: 5 }),
      );
    });
  });

  describe('computeStatus', () => {
    it('returns Matured when maturityDate in past', () => {
      expect(service.computeStatus(new Date('2020-01-01'))).toBe('Matured');
    });

    it('returns Active when maturityDate in future', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      expect(service.computeStatus(future)).toBe('Active');
    });
  });

  describe('update', () => {
    it('throws BadRequestException when reason is empty', async () => {
      await expect(service.update('id1', { description: 'New' }, '', 'uid')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when investment not found', async () => {
      mockModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.update('id1', { description: 'New' }, 'reason', 'uid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('throws BadRequestException when reason is empty', async () => {
      await expect(service.softDelete('id1', '', 'uid')).rejects.toThrow(BadRequestException);
    });
  });
});
