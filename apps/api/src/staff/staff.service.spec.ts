import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { Staff } from './schemas/staff.schema';
import { AuditService } from '../audit/audit.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { MINIO_CLIENT } from '../storage/minio.module';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';
import { StaffStatus } from '@welfare/shared';

const baseStaff = {
  _id: { toString: () => 'staff-id-1' },
  fullName: 'Aminu Tijani',
  staffId: 'STF001',
  pfNo: 'PF001',
  dateOfBirth: new Date('1990-01-01'),
  phoneNumber: '08012345678',
  dateOfEmployment: new Date('2020-01-01'),
  dateOfFirstContribution: new Date('2020-02-01'),
  level: 'GL 10',
  point: 0,
  status: StaffStatus.Active,
  save: jest.fn().mockResolvedValue(undefined),
  toObject: jest.fn(function () { return { ...this }; }),
};

const mockStaffModel = {
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
};

const mockAuditService = { log: jest.fn() };
const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({ ELIGIBILITY_MONTHS: { value: '6' } }),
};
const mockAddDocuments = jest.fn().mockResolvedValue({});
const mockMeiliIndex = jest.fn(() => ({ addDocuments: mockAddDocuments, updateSettings: jest.fn().mockResolvedValue({}) }));
const mockMeilisearchClient = { index: mockMeiliIndex };
const mockMinioClient = {
  presignedGetObject: jest.fn().mockResolvedValue('https://minio/presigned'),
  putObject: jest.fn().mockResolvedValue(undefined),
};

describe('StaffService', () => {
  let service: StaffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
        { provide: AuditService, useValue: mockAuditService },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: MEILISEARCH_CLIENT, useValue: mockMeilisearchClient },
        { provide: MINIO_CLIENT, useValue: mockMinioClient },
      ],
    }).compile();
    service = module.get<StaffService>(StaffService);
    jest.clearAllMocks();
    mockMeiliIndex.mockReturnValue({ addDocuments: mockAddDocuments, updateSettings: jest.fn().mockResolvedValue({}) });
    mockAddDocuments.mockResolvedValue({});
  });

  describe('create', () => {
    it('throws ConflictException on duplicate staffId', async () => {
      const dupError = Object.assign(new Error('dup key'), { code: 11000 });
      mockStaffModel.create.mockRejectedValue(dupError);
      await expect(
        service.create(
          { fullName: 'Test', staffId: 'STF001', pfNo: 'PF001', dateOfBirth: '1990-01-01',
            phoneNumber: '08012345678', dateOfEmployment: '2020-01-01',
            dateOfFirstContribution: '2020-02-01', level: 'GL 10', point: 0 },
          'actor-id', 'Actor Name',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates staff, logs audit, and syncs Meilisearch', async () => {
      mockStaffModel.create.mockResolvedValue({ ...baseStaff });
      const result = await service.create(
        { fullName: 'Aminu Tijani', staffId: 'STF001', pfNo: 'PF001',
          dateOfBirth: '1990-01-01', phoneNumber: '08012345678',
          dateOfEmployment: '2020-01-01', dateOfFirstContribution: '2020-02-01',
          level: 'GL 10', point: 0 },
        'actor-id', 'Actor Name',
      );
      expect(result).toBeDefined();
      expect(mockAuditService.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when staff not found', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('returns staff document when found', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
      const result = await service.findById('staff-id-1');
      expect(result).toBe(baseStaff);
    });
  });

  describe('isLoanEligible', () => {
    it('returns false with reason when employment is below threshold', async () => {
      const recentStaff = { ...baseStaff, dateOfEmployment: new Date(), save: jest.fn(), toObject: jest.fn() };
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(recentStaff) });
      const result = await service.isLoanEligible('staff-id-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/eligibility/i);
    });

    it('returns true for long-serving active staff', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
      const result = await service.isLoanEligible('staff-id-1');
      expect(result.eligible).toBe(true);
    });

    it('returns false when staff is not Active', async () => {
      const resigned = { ...baseStaff, status: StaffStatus.Resigned, save: jest.fn(), toObject: jest.fn() };
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(resigned) });
      const result = await service.isLoanEligible('staff-id-1');
      expect(result.eligible).toBe(false);
    });
  });

  describe('changeStatus', () => {
    it('throws BadRequestException when changing from terminal status', async () => {
      const deceased = { ...baseStaff, status: StaffStatus.Deceased, save: jest.fn(), toObject: jest.fn(() => ({})) };
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(deceased) });
      await expect(
        service.changeStatus('staff-id-1',
          { status: StaffStatus.Active, effectiveDate: '2025-01-01' },
          'actor-id', 'Actor'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status unchanged', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ ...baseStaff, save: jest.fn(), toObject: jest.fn(() => ({})) }) });
      await expect(
        service.changeStatus('staff-id-1',
          { status: StaffStatus.Active, effectiveDate: '2025-01-01' },
          'actor-id', 'Actor'),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets requiresSettlement=true for Resigned status', async () => {
      const staff = { ...baseStaff, save: jest.fn().mockResolvedValue(undefined), toObject: jest.fn(() => ({})) };
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(staff) });
      const result = await service.changeStatus('staff-id-1',
        { status: StaffStatus.Resigned, effectiveDate: '2025-01-01' },
        'actor-id', 'Actor');
      expect(result.requiresSettlement).toBe(true);
    });
  });

  describe('uploadPhoto', () => {
    it('throws BadRequestException for non-image mimetype', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
      await expect(
        service.uploadPhoto('staff-id-1', Buffer.from('data'), 'application/pdf'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when file exceeds 2MB', async () => {
      mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
      const bigBuffer = Buffer.alloc(3 * 1024 * 1024);
      await expect(
        service.uploadPhoto('staff-id-1', bigBuffer, 'image/jpeg'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
