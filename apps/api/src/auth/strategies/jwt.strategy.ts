import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  username: string;
  displayName: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (
        _request: unknown,
        rawJwtToken: string,
        done: (err: Error | null, secret: string) => void,
      ) => {
        const primary = config.get<string>('jwt.secret')!;
        const rotation = config.get<string>('jwt.rotationSecret') || '';
        if (!rotation) {
          done(null, primary);
          return;
        }
        // Try primary; if signature invalid fall back to rotation key so old tokens
        // issued under the previous secret remain valid during key rotation window.
        try {
          jwt.verify(rawJwtToken, primary, { algorithms: ['HS256'] });
          done(null, primary);
        } catch {
          done(null, rotation);
        }
      },
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException();
    return user;
  }
}
