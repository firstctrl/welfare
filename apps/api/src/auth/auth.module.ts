import { Module, Global } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { LdapStrategy } from './strategies/ldap.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AdLoginEnabledGuard } from './guards/ad-login-enabled.guard';
import { UsersModule } from '../users/users.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Global()
@Module({
  imports: [
    UsersModule,
    SystemConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') || '8h', algorithm: 'HS256' },
      }),
    }),
  ],
  providers: [AuthService, LocalStrategy, LdapStrategy, JwtStrategy, AdLoginEnabledGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
