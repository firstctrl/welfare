import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClaimStatus, ClaimSource, ClaimType } from '@welfare/shared';
import { ClaimsService } from './claims.service';
import { Claim } from './schemas/claim.schema';
import { Contribution } from '../contributions/schemas/contribution.schema';
import { AuditService } from '../audit/audit.service';
import { StaffService } from '../staff/staff.service';

const mockClaimModel = {
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
};
const mockContribModel = { aggregate: jest.fn() };
const mockAuditService = { log: jest.fn() };
const mockStaffService = { findManyByStaffIdPattern: jest.fn() };

describe('ClaimsService', () => {
  let service: ClaimsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        { provide: getModelToken(Claim.name), useValue: mockClaimModel },
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: AuditService, useValue: mockAuditService },
        { provide: StaffService, useValue: mockStaffService },
      ],
    }).compile();
    service = module.get(ClaimsService);
    jest.clearAllMocks();
  });

  function mockBalance(paid: number, approvedClaims: number) {
    mockContribModel.aggregate.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: paid }]) });
    mockClaimModel.aggregate.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: approvedClaims }]) });
  }

  it('getStaffBalance returns paid contributions minus approved claims', async () => {
    mockBalance(1000, 300);
    const balance = await service.getStaffBalance('staff-1');
    expect(balance).toBe(700);
  });

  it('createClaim hard-blocks when amount exceeds available balance', async () => {
    mockBalance(1000, 300); // balance = 700
    await expect(
      service.createClaim(
        { staffId: 'staff-1', claimType: ClaimType.Marriage, month: 1, year: 2026, amount: 800 },
        'actor-1', 'Actor',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockClaimModel.create).not.toHaveBeenCalled();
  });

  it('createClaim saves as Pending/ManualEntry when within balance', async () => {
    mockBalance(1000, 300); // balance = 700
    mockClaimModel.create.mockResolvedValue({ _id: 'claim-1', toObject: () => ({}) });
    const result = await service.createClaim(
      { staffId: 'staff-1', claimType: ClaimType.Marriage, month: 1, year: 2026, amount: 500 },
      'actor-1', 'Actor',
    );
    expect(mockClaimModel.create).toHaveBeenCalledWith(expect.objectContaining({
      status: ClaimStatus.Pending,
      source: ClaimSource.ManualEntry,
      amount: 500,
    }));
    expect(result._id).toBe('claim-1');
  });

  it('approveClaim re-checks balance and blocks if now insufficient', async () => {
    const pendingClaim = { _id: 'claim-1', staffId: 'staff-1', amount: 500, status: ClaimStatus.Pending, toObject: () => ({}) };
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(pendingClaim) });
    mockBalance(1000, 900); // balance now only 100, less than claim's 500

    await expect(service.approveClaim('claim-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('approveClaim sets status Approved with approvedBy/approvedAt when balance sufficient', async () => {
    const pendingClaim: any = { _id: 'claim-1', staffId: 'staff-1', amount: 500, status: ClaimStatus.Pending, save: jest.fn().mockResolvedValue(undefined), toObject: () => ({}) };
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(pendingClaim) });
    mockBalance(1000, 0); // balance 1000, sufficient

    const result = await service.approveClaim('claim-1', 'actor-1', 'Actor');

    expect(result.status).toBe(ClaimStatus.Approved);
    expect(result.approvedBy).toBe('Actor');
    expect(pendingClaim.save).toHaveBeenCalled();
  });

  it('rejectClaim sets status Rejected with the given reason', async () => {
    const pendingClaim: any = { _id: 'claim-1', status: ClaimStatus.Pending, save: jest.fn().mockResolvedValue(undefined), toObject: () => ({}) };
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(pendingClaim) });

    const result = await service.rejectClaim('claim-1', 'Not eligible', 'actor-1', 'Actor');

    expect(result.status).toBe(ClaimStatus.Rejected);
    expect(result.rejectedReason).toBe('Not eligible');
  });

  it('rejectClaim throws NotFoundException when claim is missing', async () => {
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.rejectClaim('missing', 'reason', 'actor-1', 'Actor')).rejects.toThrow(NotFoundException);
  });

  it('listClaims includes staffInfo (staffId, fullName) via aggregation lookup', async () => {
    mockClaimModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { _id: 'claim-1', staffId: 'staff-mongo-1', amount: 500, staffInfo: { staffId: 'SCW001', fullName: 'Jane Doe' } },
      ]),
    });
    mockClaimModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

    const result = await service.listClaims({ page: 1, limit: 20 });

    expect(result.data[0].staffInfo).toEqual({ staffId: 'SCW001', fullName: 'Jane Doe' });
    expect(mockStaffService.findManyByStaffIdPattern).not.toHaveBeenCalled();
  });

  it('listClaims resolves a staffId text filter to Mongo _id(s) before matching', async () => {
    mockStaffService.findManyByStaffIdPattern.mockResolvedValue([{ _id: { toString: () => 'staff-mongo-1' } }]);
    mockClaimModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    mockClaimModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

    await service.listClaims({ staffId: 'SCW001', page: 1, limit: 20 });

    expect(mockStaffService.findManyByStaffIdPattern).toHaveBeenCalledWith('SCW001');
    const pipeline = mockClaimModel.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({ $match: { staffId: 'staff-mongo-1' } });
  });

  it('listClaims returns an empty page without querying claims when no staff matches the filter', async () => {
    mockStaffService.findManyByStaffIdPattern.mockResolvedValue([]);

    const result = await service.listClaims({ staffId: 'UNKNOWN', page: 1, limit: 20 });

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    expect(mockClaimModel.aggregate).not.toHaveBeenCalled();
  });
});
