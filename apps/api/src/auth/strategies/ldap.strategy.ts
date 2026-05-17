import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-ldapauth';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';

interface RequestWithBody extends IncomingMessage {
  body: { username: string; password: string };
}

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldapauth') {
  constructor(config: ConfigService) {
    super({
      server: {
        url: config.get<string>('ldap.url') || 'ldap://localhost:389',
        bindDN: config.get<string>('ldap.bindDn') || '',
        bindCredentials: config.get<string>('ldap.bindCredentials') || '',
        searchBase: config.get<string>('ldap.searchBase') || '',
        searchFilter: '(sAMAccountName={{username}})',
        searchAttributes: ['displayName', 'mail', 'sAMAccountName'],
      },
      credentialsLookup: (req: IncomingMessage) => {
        const r = req as RequestWithBody;
        return { username: r.body.username, password: r.body.password };
      },
    });
  }

  async validate(user: { sAMAccountName: string; displayName: string; mail?: string }) {
    return {
      username: user.sAMAccountName,
      displayName: user.displayName,
      email: user.mail,
    };
  }
}
