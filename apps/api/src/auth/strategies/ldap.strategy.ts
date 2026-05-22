import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-ldapauth';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';

interface RequestWithBody extends IncomingMessage {
  body: { username: string; password: string };
}

interface LdapUser {
  sAMAccountName: string;
  displayName: string;
  mail?: string;
  memberOf?: string | string[];
}

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldapauth') {
  private readonly requiredGroup: string;

  constructor(private readonly config: ConfigService) {
    super({
      server: {
        url: config.get<string>('ldap.url') || 'ldap://localhost:389',
        bindDN: config.get<string>('ldap.bindDn') || '',
        bindCredentials: config.get<string>('ldap.bindCredentials') || '',
        searchBase: config.get<string>('ldap.searchBase') || '',
        searchFilter: '(sAMAccountName={{username}})',
        searchAttributes: ['displayName', 'mail', 'sAMAccountName', 'memberOf'],
      },
      credentialsLookup: (req: IncomingMessage) => {
        const r = req as RequestWithBody;
        return { username: r.body.username, password: r.body.password };
      },
    });
    this.requiredGroup = config.get<string>('ldap.requiredGroup') || '';
  }

  async validate(user: LdapUser) {
    if (this.requiredGroup) {
      const groups: string[] = Array.isArray(user.memberOf)
        ? user.memberOf
        : user.memberOf
        ? [user.memberOf]
        : [];
      if (!groups.includes(this.requiredGroup)) {
        throw new UnauthorizedException('Not a member of the required group');
      }
    }
    return {
      username: user.sAMAccountName,
      displayName: user.displayName,
      email: user.mail,
    };
  }
}
