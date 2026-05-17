import {
  Controller, Post, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { LdapAuthGuard } from './guards/ldap-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { LoginDto, RefreshDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  async login(@CurrentUser() user: UserDocument, @Body() _body: LoginDto) {
    return this.authService.login(user);
  }

  @Public()
  @Post('login/ldap')
  @UseGuards(LdapAuthGuard)
  @HttpCode(HttpStatus.OK)
  async loginLdap(@CurrentUser() ldapUser: { username: string; displayName: string; email?: string }, @Body() _body: LoginDto) {
    return this.authService.loginWithLdap(ldapUser);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.userId, body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: UserDocument) {
    await this.authService.logout(user._id.toString());
    return { message: 'Logged out' };
  }
}
