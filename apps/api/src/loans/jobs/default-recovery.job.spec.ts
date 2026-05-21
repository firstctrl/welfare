import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DefaultRecoveryJob } from './default-recovery.job';
import { Loan } from '../schemas/loan.schema';
import { LoanRepayment } from '../schemas/loan-repayment.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';
import { LoanRepaymentStatus, LoanStatus } from '@welfare/shared';

const mockConfig = () => ({
  PENALTY_TYPE: { value: 'Fixed' },
  PENALTY_VALUE: { value: '500' },
  END_OF_TENURE_GRACE_PERIOD_MONTHS: { value: '1' },
});

const pastDate = new Date('2026-01-05');

describe('DefaultRecoveryJob', () => {
  let job: DefaultRecoveryJob;
  let loanModel: any;
  let repaymentModel: any;
  let configService: any;
  let auditService: any;
  let contributionsService: any;

  beforeEach(async () => {
    loanModel = {
      find: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };
    repaymentModel = {
      aggregate: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
    };
    configService = { getAll: jest.fn().mockResolvedValue(mockConfig()) };
    auditService = { log: jest.fn() };
    contributionsService = {
      debitDefaulterContribution: jest.fn(),
      debitGuarantorOffset: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefaultRecoveryJob,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
      ],
    }).compile();

    job = module.get<DefaultRecoveryJob>(DefaultRecoveryJob);
    jest.clearAllMocks();
    configService.getAll.mockResolvedValue(mockConfig());
  });

  const makeLoan = (id = 'loan-1', staffId = 'staff-1', guarantorId = 'g-1') => ({
    _id: { toString: () => id },
    staffId,
    guarantorId,
    status: LoanStatus.Active,
    save: jest.fn().mockResolvedValue(undefined),
  });

  describe('detectAndMarkDefaulted (Cron 1)', () => {
    it('marks active loan as Defaulted when final instalment is past due', async () => {
      repaymentModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: 'loan-1', maxDueDate: pastDate, count: 1 }]) });
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([makeLoan()]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      repaymentModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await job.detectAndMarkDefaulted();

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: LoanStatus.Defaulted }),
        }),
      );
      expect(repaymentModel.updateMany).toHaveBeenCalledWith(
        { loanId: 'loan-1', status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] } },
        { $set: { status: LoanRepaymentStatus.Overdue } },
      );
    });

    it('skips when no candidate loans found', async () => {
      repaymentModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await job.detectAndMarkDefaulted();

      expect(loanModel.find).not.toHaveBeenCalled();
      expect(loanModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('sets endOfTenureGraceExpiry to first day of month after grace period', async () => {
      repaymentModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: 'loan-1', maxDueDate: pastDate, count: 1 }]) });
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([makeLoan()]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      repaymentModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await job.detectAndMarkDefaulted();

      const call = loanModel.findByIdAndUpdate.mock.calls[0];
      const graceExpiry: Date = call[1].$set.endOfTenureGraceExpiry;
      expect(graceExpiry.getDate()).toBe(1);
    });
  });

  describe('runGracePeriodRecovery (Cron 2)', () => {
    const makeDefaultedLoan = (id = 'loan-1') => ({
      _id: { toString: () => id },
      staffId: 'staff-1',
      guarantorId: 'g-1',
      status: LoanStatus.Defaulted,
      defaulterContributionDebited: 0,
      guarantorRestitutionOwed: 0,
      guarantorRestitutionPaid: 0,
    });

    const makeInstalment = (dueAmount = 5000, paidAmount = 0) => ({
      _id: { toString: () => 'inst-1' },
      loanId: 'loan-1',
      dueAmount,
      paidAmount,
      penaltyAmount: 0,
      status: LoanRepaymentStatus.Overdue,
      source: undefined as any,
      guarantorStaffId: undefined as any,
      paidDate: undefined as any,
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('deducts from defaulter first, then guarantor for shortfall', async () => {
      const loan = makeDefaultedLoan();
      const inst = makeInstalment(5000);

      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
      repaymentModel.find
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 2000, remaining: 3000 });
      contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 3000, remaining: 0 });

      await job.runGracePeriodRecovery();

      expect(contributionsService.debitDefaulterContribution).toHaveBeenCalledWith('staff-1', 5000, 'system', 'DefaultRecoveryJob');
      expect(contributionsService.debitGuarantorOffset).toHaveBeenCalledWith('g-1', 3000, 'loan-1', 'system', 'DefaultRecoveryJob');
      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            defaulterContributionDebited: 2000,
            guarantorRestitutionOwed: 3000,
            badDebtAmount: 0,
          }),
        }),
      );
    });

    it('records badDebtAmount when guarantor balance also insufficient', async () => {
      const loan = makeDefaultedLoan();
      const inst = makeInstalment(5000);

      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
      repaymentModel.find
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 0, remaining: 5000 });
      contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 2000, remaining: 3000 });

      await job.runGracePeriodRecovery();

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            defaulterContributionDebited: 0,
            guarantorRestitutionOwed: 2000,
            badDebtAmount: 3000,
            recoveryRanAt: expect.any(Date),
          }),
        }),
      );
    });

    it('skips when no defaulted loans past grace expiry', async () => {
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await job.runGracePeriodRecovery();

      expect(contributionsService.debitDefaulterContribution).not.toHaveBeenCalled();
    });

    it('sets recoveryRanAt even when outstanding is zero', async () => {
      const loan = makeDefaultedLoan();
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await job.runGracePeriodRecovery();

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $set: { recoveryRanAt: expect.any(Date) } },
      );
      expect(contributionsService.debitDefaulterContribution).not.toHaveBeenCalled();
    });
  });
});
