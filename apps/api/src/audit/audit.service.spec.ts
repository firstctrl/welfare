import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AuditAction, AuditEntity } from '@welfare/shared';
import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.schema';
import { Staff } from '../staff/schemas/staff.schema';

const mockAuditModel = {
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};
const mockStaffModel = {
  find: jest.fn(),
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getModelToken(AuditLog.name), useValue: mockAuditModel },
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
      ],
    }).compile();
    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('writes an audit entry', async () => {
      mockAuditModel.create.mockResolvedValue({});
      await service.log('actor-1', 'Jane', AuditAction.Create, AuditEntity.Staff, 'staff-1');
      expect(mockAuditModel.create).toHaveBeenCalledWith({
        actorId: 'actor-1',
        actorName: 'Jane',
        action: AuditAction.Create,
        entity: AuditEntity.Staff,
        entityId: 'staff-1',
        before: undefined,
        after: undefined,
        ip: undefined,
      });
    });

    it('swallows write failures instead of throwing', async () => {
      mockAuditModel.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.log('actor-1', 'Jane', AuditAction.Create, AuditEntity.Staff, 'staff-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findByEntity', () => {
    it('queries by entity and entityId, sorted newest first', async () => {
      const exec = jest.fn().mockResolvedValue([{ _id: '1' }]);
      const limit = jest.fn().mockReturnValue({ exec });
      const skip = jest.fn().mockReturnValue({ limit });
      const sort = jest.fn().mockReturnValue({ skip });
      mockAuditModel.find.mockReturnValue({ sort });

      const result = await service.findByEntity(AuditEntity.Staff, 'staff-1');

      expect(mockAuditModel.find).toHaveBeenCalledWith({ entity: AuditEntity.Staff, entityId: 'staff-1' });
      expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(result).toEqual([{ _id: '1' }]);
    });
  });

  describe('findByActor', () => {
    it('queries by actorId', async () => {
      const exec = jest.fn().mockResolvedValue([]);
      const limit = jest.fn().mockReturnValue({ exec });
      const skip = jest.fn().mockReturnValue({ limit });
      const sort = jest.fn().mockReturnValue({ skip });
      mockAuditModel.find.mockReturnValue({ sort });

      await service.findByActor('actor-1');

      expect(mockAuditModel.find).toHaveBeenCalledWith({ actorId: 'actor-1' });
    });
  });

  describe('findAll', () => {
    function mockFindChain(data: unknown[]) {
      const exec = jest.fn().mockResolvedValue(data);
      const lean = jest.fn().mockReturnValue({ exec });
      const limit = jest.fn().mockReturnValue({ lean });
      const skip = jest.fn().mockReturnValue({ limit });
      const sort = jest.fn().mockReturnValue({ skip });
      mockAuditModel.find.mockReturnValue({ sort });
      return { sort, skip, limit, lean, exec };
    }

    it('applies filters and pagination, caps limit at 200', async () => {
      mockFindChain([]);
      mockAuditModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      const result = await service.findAll({
        actorId: 'actor-1',
        entity: AuditEntity.Staff,
        action: AuditAction.Create,
        page: 2,
        limit: 9999,
      });

      expect(mockAuditModel.find).toHaveBeenCalledWith({
        actorId: 'actor-1',
        entity: AuditEntity.Staff,
        action: AuditAction.Create,
      });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(200);
    });

    it('builds a createdAt range filter from from/to', async () => {
      mockFindChain([]);
      mockAuditModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findAll({ from: '2026-01-01', to: '2026-01-31' });

      expect(mockAuditModel.find).toHaveBeenCalledWith({
        createdAt: { $gte: new Date('2026-01-01'), $lte: new Date('2026-01-31') },
      });
    });

    it('resolves staffId ObjectIds in before/after snapshots to staff codes', async () => {
      const staffObjectId = new Types.ObjectId();
      mockFindChain([
        {
          _id: 'log-1',
          before: { staffId: staffObjectId.toString() },
          after: { staffId: staffObjectId.toString(), amount: 100 },
        },
      ]);
      mockAuditModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
      mockStaffModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([{ _id: staffObjectId, staffId: 'S001' }]),
          }),
        }),
      });

      const result = await service.findAll({});

      expect(result.data[0].before).toEqual({ staffId: 'S001' });
      expect(result.data[0].after).toEqual({ staffId: 'S001', amount: 100 });
    });

    it('skips staff resolution entirely when no staffId snapshots are present', async () => {
      mockFindChain([{ _id: 'log-1', before: { foo: 'bar' }, after: undefined }]);
      mockAuditModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      await service.findAll({});

      expect(mockStaffModel.find).not.toHaveBeenCalled();
    });
  });
});
