import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ClaimType, CessationReason } from '@welfare/shared';
import { CreateClaimDto } from './create-claim.dto';

const base = {
  staffId: '507f1f77bcf86cd799439011',
  month: 1,
  year: 2026,
  amount: 500,
};

describe('CreateClaimDto', () => {
  it('normalizes an empty-string subReason to undefined for a non-Cessation claim', async () => {
    const dto = plainToInstance(CreateClaimDto, { ...base, claimType: ClaimType.Marriage, subReason: '' });
    expect(dto.subReason).toBeUndefined();
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an empty subReason when claimType is Cessation', async () => {
    const dto = plainToInstance(CreateClaimDto, { ...base, claimType: ClaimType.Cessation, subReason: '' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'subReason')).toBe(true);
  });

  it('accepts a valid subReason when claimType is Cessation', async () => {
    const dto = plainToInstance(CreateClaimDto, { ...base, claimType: ClaimType.Cessation, subReason: CessationReason.Resignation });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('ignores a leftover subReason value when claimType is not Cessation', async () => {
    const dto = plainToInstance(CreateClaimDto, { ...base, claimType: ClaimType.Marriage, subReason: CessationReason.Resignation });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
