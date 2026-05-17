import {
  Controller, Post, Body, UseGuards, HttpCode, HttpStatus, UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { LdapAuthGuard } from './guards/ldap-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserDocument } from '../users/schemas/user.schema';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: { username: string; password: string }) {
    return this.authService.validateAndLogin(body.username, body.password);
  }

  @Post('login/local')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  async loginLocal(@CurrentUser() user: UserDocument) {
    return this.authService.login(user);
  }

  @Post('login/ldap')
  @UseGuards(LdapAuthGuard)
  @HttpCode(HttpStatus.OK)
  async loginLdap(@CurrentUser() ldapUser: { username: string; displayName: string; email?: string }) {
    return this.authService.loginWithLdap(ldapUser);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { userId: string; refreshToken: string }) {
    if (!body.userId || !body.refreshToken) throw new UnauthorizedException();
    return this.authService.refresh(body.userId, body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { userId: string }) {
    if (!body.userId) return;
    await this.authService.logout(body.userId);
    return { message: 'Logged out' };
  }
}
