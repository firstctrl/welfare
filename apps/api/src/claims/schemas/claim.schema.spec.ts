import * as mongoose from 'mongoose';
import { ClaimType, ClaimStatus, ClaimSource } from '@welfare/shared';
import { Claim, ClaimSchema } from './claim.schema';

describe('Claim schema', () => {
  const ClaimModel = mongoose.model(Claim.name, ClaimSchema);

  it('defaults status to Pending', () => {
    const doc = new ClaimModel({
      staffId: 'staff-1',
      claimType: ClaimType.Marriage,
      month: 1,
      year: 2026,
      amount: 500,
      source: ClaimSource.ManualEntry,
      recordedBy: 'tester',
    });
    expect(doc.status).toBe(ClaimStatus.Pending);
    expect(doc.validateSync()).toBeUndefined();
  });

  it('rejects a negative amount', () => {
    const doc = new ClaimModel({
      staffId: 'staff-1',
      claimType: ClaimType.Marriage,
      month: 1,
      year: 2026,
      amount: -1,
      source: ClaimSource.ManualEntry,
      recordedBy: 'tester',
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors.amount).toBeDefined();
  });
});
