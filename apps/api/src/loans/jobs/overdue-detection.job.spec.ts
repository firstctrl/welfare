import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OverdueDetectionJob } from './overdue-detection.job';
import { LoanRepayment } from '../schemas/loan-repayment.schema';
import { Loan } from '../schemas/loan.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';
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

  beforeEach(async () => {
    repaymentModel = { find: jest.fn() };
    loanModel = { findById: jest.fn() };
    configService = { getAll: jest.fn() };
    auditService = { log: jest.fn() };
    contributionsService = { debitGuarantorOffset: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueDetectionJob,
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
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
    guarantorStaffId: undefined as any,
    paidDate: undefined as any,
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

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Partial);
    expect(inst.paidAmount).toBe(1000);

    global.Date = realNow;
  });
});
