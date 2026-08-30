import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UnprocessableEntityException } from '@nestjs/common';
import { AuditAction, AuditEntity, ConfigKey } from '@welfare/shared';
import { SystemConfigService } from './system-config.service';
import { ConfigSetting } from './system-config.schema';
import { REDIS_CLIENT } from '../cache/redis.module';
import { AuditService } from '../audit/audit.service';

const mockConfigModel = {
  updateOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
};
const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
const mockAuditService = { log: jest.fn() };

describe('SystemConfigService', () => {
  let service: SystemConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemConfigService,
        { provide: getModelToken(ConfigSetting.name), useValue: mockConfigModel },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get<SystemConfigService>(SystemConfigService);
    jest.clearAllMocks();
  });

  describe('getAll', () => {
    it('returns the cached map without hitting mongo when redis has a value', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ [ConfigKey.LoanMinAmount]: { value: '500' } }));

      const result = await service.getAll();

      expect(result).toEqual({ [ConfigKey.LoanMinAmount]: { value: '500' } });
      expect(mockConfigModel.find).not.toHaveBeenCalled();
    });

    it('falls back to mongo and repopulates the cache on a cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockConfigModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { key: ConfigKey.LoanMinAmount, value: '500', updatedBy: 'system', updatedAt: new Date('2026-01-01') },
          ]),
        }),
      });

      const result = await service.getAll();

      expect(result[ConfigKey.LoanMinAmount].value).toBe('500');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'config:all',
        expect.any(String),
        'EX',
        300,
      );
    });
  });

  describe('bulkUpdate', () => {
    beforeEach(() => {
      mockRedis.get.mockResolvedValue(null);
      mockConfigModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });
      mockConfigModel.findOneAndUpdate.mockResolvedValue({});
    });

    it('rejects unknown config keys', async () => {
      await expect(
        service.bulkUpdate({ NOT_A_REAL_KEY: '1' }, 'u1', 'Jane'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects a value that fails per-key validation', async () => {
      await expect(
        service.bulkUpdate({ [ConfigKey.LoanMinAmount]: '-5' }, 'u1', 'Jane'),
      ).rejects.toThrow(/LoanMinAmount must be > 0/);
    });

    it('rejects when LoanMinAmount would be >= LoanMaxAmount', async () => {
      mockConfigModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { key: ConfigKey.LoanMaxAmount, value: '1000', updatedBy: 'system', updatedAt: new Date() },
          ]),
        }),
      });

      await expect(
        service.bulkUpdate({ [ConfigKey.LoanMinAmount]: '1000' }, 'u1', 'Jane'),
      ).rejects.toThrow(/must be less than LoanMaxAmount/);
    });

    it('accepts LoanMinAmount below the existing LoanMaxAmount', async () => {
      mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockConfigModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { key: ConfigKey.LoanMaxAmount, value: '1000', updatedBy: 'system', updatedAt: new Date() },
          ]),
        }),
      });

      await expect(
        service.bulkUpdate({ [ConfigKey.LoanMinAmount]: '500' }, 'u1', 'Jane'),
      ).resolves.toBeDefined();
    });

    it('persists changes, invalidates the cache, and writes an audit log', async () => {
      await service.bulkUpdate({ [ConfigKey.LoanMaxTenure]: '12' }, 'u1', 'Jane', '10.0.0.1');

      expect(mockConfigModel.findOneAndUpdate).toHaveBeenCalledWith(
        { key: ConfigKey.LoanMaxTenure },
        { value: '12', updatedBy: 'Jane' },
        { upsert: true, new: true, runValidators: true },
      );
      expect(mockRedis.del).toHaveBeenCalledWith('config:all');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        'u1', 'Jane', AuditAction.ConfigChange, AuditEntity.Config, 'system',
        expect.any(Object), expect.any(Object), '10.0.0.1',
      );
    });
  });

  describe('getPublic', () => {
    it('defaults adLoginEnabled to true when unset', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({}));
      expect(await service.getPublic()).toEqual({ adLoginEnabled: true });
    });

    it('reflects a stored false value', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ [ConfigKey.AdLoginEnabled]: { value: 'false' } }));
      expect(await service.getPublic()).toEqual({ adLoginEnabled: false });
    });
  });
});
