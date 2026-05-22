import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { UserRole } from '@welfare/shared';
import * as bcrypt from 'bcrypt';

const mockUser = (overrides = {}) => ({
  _id: { toString: () => 'user-id-1' },
  username: 'jdoe',
  displayName: 'John Doe',
  role: UserRole.WelfareOfficer,
  source: 'local',
  isActive: true,
  passwordHash: 'hashed',
  save: jest.fn().mockResolvedValue(undefined),
  toObject: jest.fn(function () { return { ...this }; }),
  ...overrides,
});

const mockUserModel = {
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('updateRole', () => {
    it('updates role and returns updated user', async () => {
      const updated = mockUser({ role: UserRole.WelfareManager });
      mockUserModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) });
      const result = await service.updateRole('user-id-1', UserRole.WelfareManager);
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        { $set: { role: UserRole.WelfareManager } },
        { new: true },
      );
      expect(result.role).toBe(UserRole.WelfareManager);
    });

    it('throws NotFoundException when user not found', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.updateRole('bad-id', UserRole.Admin)).rejects.toThrow(NotFoundException);
    });
  });

  describe('resetPassword', () => {
    it('hashes and saves new password for local user', async () => {
      const user = mockUser({ source: 'local' });
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(user) }),
      });
      await service.resetPassword('user-id-1', 'NewPass@123');
      expect(user.save).toHaveBeenCalled();
      const valid = await bcrypt.compare('NewPass@123', user.passwordHash as string);
      expect(valid).toBe(true);
    });

    it('throws BadRequestException for LDAP user', async () => {
      const ldapUser = mockUser({ source: 'ldap' });
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(ldapUser) }),
      });
      await expect(service.resetPassword('user-id-1', 'NewPass@123')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user not found', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      });
      await expect(service.resetPassword('bad-id', 'NewPass@123')).rejects.toThrow(NotFoundException);
    });
  });
});
