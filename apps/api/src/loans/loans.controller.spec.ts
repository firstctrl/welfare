import 'reflect-metadata';
import { LoansController } from './loans.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '@welfare/shared';

describe('LoansController — delete route role gate', () => {
  it('restricts DELETE /loans/:id to WelfareManager/Admin', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, LoansController.prototype.deleteLoan);
    expect(roles).toEqual([UserRole.WelfareManager, UserRole.Admin]);
  });

  it('restricts DELETE /loans/bulk to WelfareManager/Admin', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, LoansController.prototype.bulkDelete);
    expect(roles).toEqual([UserRole.WelfareManager, UserRole.Admin]);
  });

  it('keeps the same role gate regardless of the ForceDeleteLoanDto body', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, LoansController.prototype.deleteLoan);
    expect(roles).toEqual([UserRole.WelfareManager, UserRole.Admin]);
  });
});
