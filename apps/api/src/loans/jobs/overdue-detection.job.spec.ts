import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OverdueDetectionJob } from './overdue-detection.job';
import { LoanRepayment } from '../schemas/loan-repayment.schema';
import { Loan } from '../schemas/loan.schema';
import { Discount } from '../schemas/discount.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';
import { EmailService } from '../../email/email.service';
import { LoansService } from '../loans.service';
import { LoanRepaymentStatus, LoanStatus, RepaymentSource } from '@welfare/shared';

const mockConfig = () => ({
  PENALTY_TYPE: { value: 'Fixed' },
  PENALTY_VALUE: { value: '500' },
  GRACE_PERIOD_DAYS: { value: '0' },
});

describe('OverdueDetectionJob', () => {
  let job: OverdueDetectionJob;
  let repaymentModel: any;
  let loanModel: any;
  let configService: any;
  let auditService: any;
  let contributionsService: any;
  let loansService: any;

  beforeEach(async () => {
    repaymentModel = { find: jest.fn() };
    loanModel = { findById: jest.fn(), find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }), updateOne: jest.fn().mockResolvedValue({}) };
    configService = { getAll: jest.fn() };
    auditService = { log: jest.fn() };
    contributionsService = {
      debitGuarantorOffset: jest.fn(),
      debitDefaulterContribution: jest.fn().mockResolvedValue({ debited: 0, remaining: 0 }),
    };
    loansService = { checkAndCompleteIfDone: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueDetectionJob,
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(Discount.name), useValue: { create: jest.fn(), updateOne: jest.fn() } },
        { provide: getModelToken(Staff.name), useValue: { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) } },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
        { provide: EmailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
        { provide: LoansService, useValue: loansService },
      ],
    }).compile();

    job = module.get<OverdueDetectionJob>(OverdueDetectionJob);
    jest.clearAllMocks();
  });

  const pastDate = new Date('2026-01-05');

  const makeInstalment = (loanId = 'loan-1', overrideDate = pastDate) => ({
    _id: { toString: () => 'inst-1' },
    loanId,
    dueDate: overrideDate,
    dueAmount: 3500,
    paidAmount: 0,
    penaltyAmount: 0,
    status: LoanRepaymentStatus.Pending,
    source: undefined as any,
    guarantorDebited: undefined as any,
    borrowerDebited: undefined as any,
    guarantorStaffId: undefined as any,
    paidDate: undefined as any,
    payments: [] as any[],
    save: jest.fn().mockResolvedValue(undefined),
  });

  const makeLoan = (guarantorId = 'guarantor-id') => ({
    _id: { toString: () => 'loan-1' },
    guarantorId,
    status: LoanStatus.Active,
  });

  it('marks pending instalments as Overdue and applies penalty', async () => {
    const inst = makeInstalment();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Overdue);
    expect(inst.penaltyAmount).toBe(500);
    expect(inst.save).toHaveBeenCalled();
  });

  it('triggers guarantor offset when grace period has passed (gracePeriodDays=0 and new month)', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    const loan = makeLoan('guarantor-id');
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(contributionsService.debitGuarantorOffset).toHaveBeenCalledWith(
      'guarantor-id',
      expect.any(Number),
      'loan-1',
      'system',
      'Overdue Detection Job',
      undefined,
      undefined,
    );
    expect(inst.status).toBe(LoanRepaymentStatus.Paid);
    expect(inst.source).toBe(RepaymentSource.GuarantorOffset);

    global.Date = realNow;
  });

  it('marks instalment Partial when guarantor balance is insufficient', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 1000, remaining: 3000 });
    // Borrower also has no balance to cover the shortfall
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 0, remaining: 3000 });

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Partial);
    expect(inst.paidAmount).toBe(1000);

    global.Date = realNow;
  });

  it('does not touch a legacy loan instalment dated before the cutover date', async () => {
    const inst = makeInstalment('loan-1', new Date('2025-06-01'));
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...makeLoan(), legacy: true, legacyCutoverDate: new Date('2026-01-01') }),
    });
    configService.getAll.mockResolvedValue(mockConfig());

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Pending);
    expect(inst.save).not.toHaveBeenCalled();
  });

  it('processes a legacy loan instalment dated after the cutover date normally', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-02-01'));
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...makeLoan(), legacy: true, legacyCutoverDate: new Date('2026-01-01') }),
    });
    configService.getAll.mockResolvedValue(mockConfig());

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Overdue);
    expect(inst.save).toHaveBeenCalled();
  });

  it('excludes legacy loans from the forfeiture candidate query', async () => {
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    configService.getAll.mockResolvedValue(mockConfig());

    await job.detectAndProcess();

    expect(loanModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ legacy: { $ne: true } }),
    );
  });

  it('calls checkAndCompleteIfDone for the instalment\'s loan after processing it', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(loansService.checkAndCompleteIfDone).toHaveBeenCalledWith('loan-1', 'system', 'Overdue Detection Job');

    global.Date = realNow;
  });

  it('labels source DefaulterDeduction and records the split when only the borrower is debited', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 0, remaining: 4000 });
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(inst.source).toBe(RepaymentSource.DefaulterDeduction);
    expect(inst.guarantorDebited).toBe(0);
    expect(inst.borrowerDebited).toBe(4000);
    expect(inst.payments).toHaveLength(1);
    expect(inst.payments[0]).toMatchObject({ amount: 4000, source: RepaymentSource.DefaulterDeduction });

    global.Date = realNow;
  });

  it('keeps source GuarantorOffset and records both split amounts when the payment is mixed', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 1000, remaining: 3000 });
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 3000, remaining: 0 });

    await job.detectAndProcess();

    expect(inst.source).toBe(RepaymentSource.GuarantorOffset);
    expect(inst.guarantorDebited).toBe(1000);
    expect(inst.borrowerDebited).toBe(3000);
    expect(inst.payments).toHaveLength(1);
    expect(inst.payments[0]).toMatchObject({ amount: 4000, source: RepaymentSource.GuarantorOffset });

    global.Date = realNow;
  });

  it('does not push a payments entry when nothing was debited', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 0, remaining: 4000 });
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 0, remaining: 4000 });

    await job.detectAndProcess();

    expect(inst.payments).toHaveLength(0);
    expect(inst.source).toBeUndefined();

    global.Date = realNow;
  });
});
