import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { PasswordResetService } from '../password-reset/password-reset.service';

const mockUserModel = {
  findOne: jest.fn(),
  findById: jest.fn(),
};

const mockPasswordResetService = { requestReset: jest.fn().mockResolvedValue(undefined) };

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: PasswordResetService, useValue: mockPasswordResetService },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('findByEmail', () => {
    it('queries by email scoped to local accounts', async () => {
      mockUserModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await service.findByEmail('someone@example.com');
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ email: 'someone@example.com', source: 'local' });
    });
  });

  describe('sendResetLink', () => {
    it('requests a reset for a local user with an email on file', async () => {
      const user = { _id: { toString: () => 'u1' }, source: 'local', email: 'u1@example.com' };
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });

      await service.sendResetLink('u1');

      expect(mockPasswordResetService.requestReset).toHaveBeenCalledWith(user, { triggeredByAdmin: true });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.sendResetLink('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for an LDAP account', async () => {
      const user = { _id: { toString: () => 'u1' }, source: 'ldap', email: 'u1@example.com' };
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });
      await expect(service.sendResetLink('u1')).rejects.toThrow(BadRequestException);
      expect(mockPasswordResetService.requestReset).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the user has no email', async () => {
      const user = { _id: { toString: () => 'u1' }, source: 'local', email: undefined };
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });
      await expect(service.sendResetLink('u1')).rejects.toThrow(BadRequestException);
      expect(mockPasswordResetService.requestReset).not.toHaveBeenCalled();
    });
  });
});
