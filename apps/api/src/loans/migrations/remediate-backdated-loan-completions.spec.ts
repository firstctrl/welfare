import { remediateLoan, backfillRepaymentSource } from './remediate-backdated-loan-completions';
import { RepaymentSource } from '@welfare/shared';

describe('remediate-backdated-loan-completions', () => {
  describe('remediateLoan', () => {
    const makeQualifyingLoan = () => ({
      _id: { toString: () => 'loan-1' },
      status: 'Active',
      guarantorId: 'g-1',
      guarantorRestitutionOwed: 1600,
      guarantorRestitutionPaid: 0,
    });

    it('does not write anything in dry-run mode even when the loan qualifies, and reports the amount that would be settled', async () => {
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeQualifyingLoan()) }),
        updateOne: jest.fn(),
      };
      const repaymentModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      };
      const contributionModel = { create: jest.fn() };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel } as any, false);

      expect(result.action).toBe('would-settle');
      expect((result as any).owed).toBe(1600);
      expect(loanModel.updateOne).not.toHaveBeenCalled();
      expect(contributionModel.create).not.toHaveBeenCalled();
    });

    it('skips and does not write when the loan no longer qualifies (already settled)', async () => {
      const loan = { ...makeQualifyingLoan(), guarantorRestitutionPaid: 1600 };
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) }),
        updateOne: jest.fn(),
      };
      const repaymentModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ status: 'Paid' }]) }) };
      const contributionModel = { create: jest.fn() };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(loanModel.updateOne).not.toHaveBeenCalled();
    });

    it('skips and does not write when an instalment is still unpaid', async () => {
      const loan = makeQualifyingLoan();
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) }),
        updateOne: jest.fn(),
      };
      const repaymentModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ status: 'Paid' }, { status: 'Pending' }]) }) };
      const contributionModel = { create: jest.fn() };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(loanModel.updateOne).not.toHaveBeenCalled();
    });

    it('settles restitution, flips status to Completed via a status-guarded update, and writes an audit row when confirmed and loan qualifies', async () => {
      const loan = makeQualifyingLoan();
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      };
      const repaymentModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };
      const contributionModel = { create: jest.fn().mockResolvedValue({}) };
      const auditModel = { create: jest.fn().mockResolvedValue({}) };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel, auditModel } as any, true);

      expect(result.action).toBe('settled');
      expect(loanModel.updateOne).toHaveBeenCalledWith(
        { _id: 'loan-1', status: 'Active' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'Completed' }), $inc: { guarantorRestitutionPaid: 1600 } }),
      );
      expect(contributionModel.create).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'g-1', paidAmount: 1600, isDebit: false }));
      expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Loan', entityId: 'loan-1' }));

      const updateOneOrder = loanModel.updateOne.mock.invocationCallOrder[0];
      const contributionCreateOrder = contributionModel.create.mock.invocationCallOrder[0];
      expect(updateOneOrder).toBeLessThan(contributionCreateOrder);
    });

    it('does not credit the guarantor when the status-guarded loan update finds nothing to match (lost a race since the report was written) — skips instead of risking a double credit', async () => {
      const loan = makeQualifyingLoan();
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
      };
      const repaymentModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };
      const contributionModel = { create: jest.fn() };
      const auditModel = { create: jest.fn() };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel, auditModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(contributionModel.create).not.toHaveBeenCalled();
      expect(auditModel.create).not.toHaveBeenCalled();
    });
  });

  describe('backfillRepaymentSource', () => {
    const makeMislabeledRow = () => ({ _id: 'r1', loanId: 'loan-1', instalmentNumber: 12, source: 'GuarantorOffset', paidAmount: 400 });

    it('does not write in dry-run mode, and reports the computed source and split', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeMislabeledRow()) }),
        updateOne: jest.fn(),
      };
      const contributionModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ source: 'DefaulterDeduction', paidAmount: 400 }]) }),
      };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel } as any, false);

      expect(result.action).toBe('would-backfill');
      expect((result as any).source).toBe(RepaymentSource.DefaulterDeduction);
      expect((result as any).guarantorDebited).toBe(0);
      expect((result as any).borrowerDebited).toBe(400);
      expect(repaymentModel.updateOne).not.toHaveBeenCalled();
    });

    it('backfills source and split amounts from matching Contribution debit rows and writes an audit row when confirmed', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeMislabeledRow()) }),
        updateOne: jest.fn().mockResolvedValue({}),
      };
      const contributionModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ source: 'DefaulterDeduction', paidAmount: 400 }]) }),
      };
      const auditModel = { create: jest.fn().mockResolvedValue({}) };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel, auditModel } as any, true);

      expect(result.action).toBe('backfilled');
      expect(repaymentModel.updateOne).toHaveBeenCalledWith(
        { _id: 'r1' },
        { $set: { source: RepaymentSource.DefaulterDeduction, guarantorDebited: 0, borrowerDebited: 400 } },
      );
      expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ entity: 'LoanRepayment', entityId: 'r1' }));
    });

    it('skips when no matching repayment row is found', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
        updateOne: jest.fn(),
      };
      const contributionModel = { find: jest.fn() };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(repaymentModel.updateOne).not.toHaveBeenCalled();
    });

    it('skips when the row is not currently labeled GuarantorOffset — nothing mislabeled to backfill', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ...makeMislabeledRow(), source: 'DirectPayment' }) }),
        updateOne: jest.fn(),
      };
      const contributionModel = { find: jest.fn() };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(result.reason).toMatch(/not.*GuarantorOffset/i);
      expect(repaymentModel.updateOne).not.toHaveBeenCalled();
    });

    it('skips when no matching Contribution debit rows are found for the instalment', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeMislabeledRow()) }),
        updateOne: jest.fn(),
      };
      const contributionModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(result.reason).toMatch(/no matching/i);
      expect(repaymentModel.updateOne).not.toHaveBeenCalled();
    });

    it('skips when the computed split does not add up to the row\'s recorded paidAmount', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeMislabeledRow()) }),
        updateOne: jest.fn(),
      };
      const contributionModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ source: 'DefaulterDeduction', paidAmount: 250 }]) }),
      };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(result.reason).toMatch(/mismatch/i);
      expect(repaymentModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
