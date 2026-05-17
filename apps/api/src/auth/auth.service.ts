import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import { JwtPayload } from './strategies/jwt.strategy';
import * as crypto from 'crypto';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async login(user: UserDocument): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = crypto.randomBytes(40).toString('hex');
    await this.redis.set(
      `refresh:${user._id.toString()}`,
      refreshToken,
      'EX',
      REFRESH_TTL_SECONDS,
    );
    return { accessToken, refreshToken };
  }

  async loginWithLdap(ldapUser: { username: string; displayName: string; email?: string }): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.provisionFromLdap(ldapUser);
    return this.login(user);
  }

  async validateAndLogin(username: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findByUsernameWithPassword(username);
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    if (user.source === 'local') {
      const valid = await this.usersService.validatePassword(user, password);
      if (!valid) throw new UnauthorizedException('Invalid credentials');
      user.lastLogin = new Date();
      await user.save();
      return this.login(user);
    }
    throw new UnauthorizedException('Please use LDAP login');
  }

  async refresh(userId: string, refreshToken: string): Promise<{ accessToken: string }> {
    const stored = await this.redis.get(`refresh:${userId}`);
    if (!stored || stored !== refreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.usersService.findById(userId);
    if (!user || !user.isActive) throw new UnauthorizedException();
    const payload: JwtPayload = {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
    };
    return { accessToken: this.jwtService.sign(payload) };
  }

  async logout(userId: string): Promise<void> {
    await this.redis.del(`refresh:${userId}`);
  }
}
