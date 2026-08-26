import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetToken } from './schemas/password-reset-token.schema';
import { User } from '../users/schemas/user.schema';
import { EmailService } from '../email/email.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { EmailLogType, EmailTriggerSource } from '@welfare/shared';

const mockTokenModel = {
  create: jest.fn(),
  findOne: jest.fn(),
  updateMany: jest.fn(),
};

const mockUserModel = {
  findById: jest.fn(),
};

const mockEmailService = { send: jest.fn().mockResolvedValue(undefined) };
const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Welfare System' } }),
};

const fakeUser = {
  _id: { toString: () => 'user-1' },
  displayName: 'Aminu Tijani',
  email: 'aminu@example.com',
};

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  beforeEach(async () => {
    process.env.APP_URL = 'https://welfare.example.com';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: getModelToken(PasswordResetToken.name), useValue: mockTokenModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: EmailService, useValue: mockEmailService },
        { provide: SystemConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<PasswordResetService>(PasswordResetService);
    jest.clearAllMocks();
    mockConfigService.getAll.mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Welfare System' } });
    mockTokenModel.create.mockResolvedValue({});
    mockTokenModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
  });

  describe('requestReset', () => {
    it('stores a hash of the token, not the raw value, and emails the user', async () => {
      await service.requestReset(fakeUser as any, { triggeredByAdmin: false });

      expect(mockTokenModel.create).toHaveBeenCalledTimes(1);
      const created = mockTokenModel.create.mock.calls[0][0];
      expect(created.userId).toBe('user-1');
      expect(created.tokenHash).toHaveLength(64); // sha256 hex
      expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(mockEmailService.send).toHaveBeenCalledWith(
        { staffId: 'user-1', staffName: 'Aminu Tijani', email: 'aminu@example.com' },
        EmailLogType.PasswordReset,
        expect.any(String),
        expect.stringContaining('https://welfare.example.com/reset-password?token='),
        EmailTriggerSource.Manual,
      );
    });
  });

  describe('consumeToken', () => {
    it('updates the password and marks the token used for a valid token', async () => {
      const record = {
        userId: 'user-1',
        usedAt: undefined,
        expiresAt: new Date(Date.now() + 60_000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(record) });
      const userDoc: { passwordHash?: string; save: jest.Mock } = { passwordHash: undefined, save: jest.fn().mockResolvedValue(undefined) };
      mockUserModel.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(userDoc) }) });

      await service.consumeToken('raw-token-value', 'NewPassw0rd!');

      expect(record.usedAt).toBeInstanceOf(Date);
      expect(record.save).toHaveBeenCalled();
      expect(userDoc.save).toHaveBeenCalled();
      expect(await bcrypt.compare('NewPassw0rd!', userDoc.passwordHash!)).toBe(true);
      expect(mockTokenModel.updateMany).toHaveBeenCalledWith(
        { userId: 'user-1', usedAt: { $exists: false } },
        { $set: { usedAt: expect.any(Date) } },
      );
    });

    it('rejects an unknown token', async () => {
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.consumeToken('bad-token', 'x')).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      const record = { userId: 'user-1', usedAt: undefined, expiresAt: new Date(Date.now() - 1000) };
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(record) });
      await expect(service.consumeToken('expired-token', 'x')).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-used token', async () => {
      const record = { userId: 'user-1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(record) });
      await expect(service.consumeToken('used-token', 'x')).rejects.toThrow(BadRequestException);
    });
  });
});
