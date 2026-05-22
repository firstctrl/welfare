import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { LdapStrategy } from './ldap.strategy';

function makeStrategy(requiredGroup: string | undefined): LdapStrategy {
  const config = {
    get: (key: string) => {
      if (key === 'ldap.requiredGroup') return requiredGroup ?? '';
      return '';
    },
  } as unknown as ConfigService;
  return new (class extends LdapStrategy {
    constructor() { super(config); }
  })();
}

describe('LdapStrategy.validate', () => {
  it('passes when requiredGroup is not configured', async () => {
    const strategy = makeStrategy(undefined);
    const result = await strategy.validate({
      sAMAccountName: 'jdoe',
      displayName: 'John Doe',
      mail: 'jdoe@example.com',
      memberOf: [],
    });
    expect(result.username).toBe('jdoe');
  });

  it('passes when user is a member of the required group', async () => {
    const strategy = makeStrategy('CN=welfare_group,OU=Groups,DC=example,DC=com');
    const result = await strategy.validate({
      sAMAccountName: 'jdoe',
      displayName: 'John Doe',
      memberOf: ['CN=welfare_group,OU=Groups,DC=example,DC=com', 'CN=other,DC=example,DC=com'],
    });
    expect(result.username).toBe('jdoe');
  });

  it('throws UnauthorizedException when user is not a member', async () => {
    const strategy = makeStrategy('CN=welfare_group,OU=Groups,DC=example,DC=com');
    await expect(
      strategy.validate({
        sAMAccountName: 'jdoe',
        displayName: 'John Doe',
        memberOf: ['CN=other_group,DC=example,DC=com'],
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when memberOf is absent and group is required', async () => {
    const strategy = makeStrategy('CN=welfare_group,OU=Groups,DC=example,DC=com');
    await expect(
      strategy.validate({ sAMAccountName: 'jdoe', displayName: 'John Doe' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
