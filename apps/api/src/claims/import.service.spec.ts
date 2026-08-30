import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ClaimStatus, ClaimSource, ClaimType } from '@welfare/shared';
import * as XLSX from 'xlsx';
import { ImportService } from './import.service';
import { ClaimImportBatch } from './schemas/claim-import-batch.schema';
import { Claim } from './schemas/claim.schema';
import { ClaimsService } from './claims.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: jest.fn(), findById: jest.fn() };
const mockClaimModel = { create: jest.fn() };
const mockClaimsService = { getStaffBalance: jest.fn().mockResolvedValue(100000) };
const mockStaffService = { findByStaffId: jest.fn() };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('ImportService (claims)', () => {
  let service: ImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: getModelToken(ClaimImportBatch.name), useValue: mockBatchModel },
        { provide: getModelToken(Claim.name), useValue: mockClaimModel },
        { provide: ClaimsService, useValue: mockClaimsService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(ImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockClaimsService.getStaffBalance.mockResolvedValue(100000);
  });

  function excelBuffer(rows: Record<string, unknown>[]): Buffer {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('matches a valid row and saves it as Approved/LegacyImport', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Marriage', Month: 3, Year: 2024, Amount: 500 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result).toEqual({ batchId: 'batch-1', matched: 1, flagged: 0, total: 1 });
    expect(mockClaimModel.create).toHaveBeenCalledWith(expect.objectContaining({
      staffId: 'staff-mongo-1',
      claimType: ClaimType.Marriage,
      month: 3,
      year: 2024,
      amount: 500,
      status: ClaimStatus.Approved,
      source: ClaimSource.LegacyImport,
      importBatchId: 'batch-1',
    }));
  });

  it('flags a row with an unknown Staff ID and does not create a claim', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-2' } });
    mockStaffService.findByStaffId.mockResolvedValue(null);

    const buffer = excelBuffer([
      { 'Staff ID': 'UNKNOWN', 'Full Name': 'Ghost', 'Claim Type': 'Funeral', Month: 1, Year: 2024, Amount: 200 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(0);
    expect(result.flagged).toBe(1);
    expect(mockClaimModel.create).not.toHaveBeenCalled();
  });

  it('flags a Cessation row missing Sub Reason', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-3' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Cessation', Month: 1, Year: 2024, Amount: 900 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(0);
    expect(result.flagged).toBe(1);
    expect(mockClaimModel.create).not.toHaveBeenCalled();
  });

  it('imports a Cessation row when Sub Reason is provided', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-4' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Cessation', Month: 1, Year: 2024, Amount: 900, 'Sub Reason': 'Resignation' },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(1);
    expect(mockClaimModel.create).toHaveBeenCalledWith(expect.objectContaining({ subReason: 'Resignation' }));
  });

  it('imports a row that exceeds balance but flags it as a soft warning (does not block)', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-5' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });
    mockClaimsService.getStaffBalance.mockResolvedValue(100); // balance less than claim amount

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Marriage', Month: 1, Year: 2024, Amount: 500 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(1); // still imported
    expect(result.flagged).toBe(1); // and flagged
    expect(mockClaimModel.create).toHaveBeenCalled();
  });
});
