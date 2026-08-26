import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PasswordResetService } from '../password-reset/password-reset.service';

const mockUsersService = { findByEmail: jest.fn() };
const mockPasswordResetService = {
  requestReset: jest.fn().mockResolvedValue(undefined),
  consumeToken: jest.fn().mockResolvedValue(undefined),
};
const mockJwtService = { sign: jest.fn() };
const mockConfigService = { get: jest.fn() };
const mockRedis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PasswordResetService, useValue: mockPasswordResetService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('forgotPassword', () => {
    it('requests a reset when the email matches a local user', async () => {
      const user = { _id: { toString: () => 'u1' }, email: 'u1@example.com' };
      mockUsersService.findByEmail.mockResolvedValue(user);

      await service.forgotPassword('u1@example.com');

      expect(mockPasswordResetService.requestReset).toHaveBeenCalledWith(user, { triggeredByAdmin: false });
    });

    it('does nothing (and does not throw) when no user matches', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      await expect(service.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
      expect(mockPasswordResetService.requestReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('delegates to PasswordResetService.consumeToken', async () => {
      await service.resetPassword('raw-token', 'NewPassw0rd!');
      expect(mockPasswordResetService.consumeToken).toHaveBeenCalledWith('raw-token', 'NewPassw0rd!');
    });
  });
});
