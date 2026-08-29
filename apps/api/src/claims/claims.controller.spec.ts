import { Test, TestingModule } from '@nestjs/testing';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { ImportService } from './import.service';

const mockClaimsService = {
  createClaim: jest.fn(),
  approveClaim: jest.fn(),
  rejectClaim: jest.fn(),
  findByStaff: jest.fn(),
  getStaffBalance: jest.fn().mockResolvedValue(500),
  listClaims: jest.fn(),
  deleteClaim: jest.fn(),
};
const mockImportService = { processImport: jest.fn(), listBatches: jest.fn(), getBatch: jest.fn() };

describe('ClaimsController', () => {
  let controller: ClaimsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClaimsController],
      providers: [
        { provide: ClaimsService, useValue: mockClaimsService },
        { provide: ImportService, useValue: mockImportService },
      ],
    }).compile();
    controller = module.get(ClaimsController);
    jest.clearAllMocks();
  });

  it('create() delegates to claimsService.createClaim with actor identity', async () => {
    const dto = { staffId: 'staff-1', claimType: 'Marriage' as any, month: 1, year: 2026, amount: 500 };
    const user = { sub: 'actor-1', displayName: 'Actor' };
    await controller.create(dto, user);
    expect(mockClaimsService.createClaim).toHaveBeenCalledWith(dto, 'actor-1', 'Actor');
  });

  it('approve() delegates to claimsService.approveClaim', async () => {
    const user = { sub: 'actor-1', displayName: 'Actor' };
    await controller.approve('claim-1', user);
    expect(mockClaimsService.approveClaim).toHaveBeenCalledWith('claim-1', 'actor-1', 'Actor');
  });

  it('reject() delegates to claimsService.rejectClaim with the reason', async () => {
    const user = { sub: 'actor-1', displayName: 'Actor' };
    await controller.reject('claim-1', { reason: 'Not eligible' }, user);
    expect(mockClaimsService.rejectClaim).toHaveBeenCalledWith('claim-1', 'Not eligible', 'actor-1', 'Actor');
  });

  it('getBalance() wraps the numeric balance in an object', async () => {
    const result = await controller.getBalance('staff-1');
    expect(result).toEqual({ balance: 500 });
  });
});
