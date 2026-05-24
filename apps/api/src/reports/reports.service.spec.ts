import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ReportsService } from './reports.service';
import { Contribution } from '../contributions/schemas/contribution.schema';
import { Loan } from '../loans/schemas/loan.schema';
import { LoanRepayment } from '../loans/schemas/loan-repayment.schema';
import { Staff } from '../staff/schemas/staff.schema';
import { ImportBatch } from '../contributions/schemas/import-batch.schema';
import {
  ContributionStatus,
  LoanStatus,
  LoanRepaymentStatus,
  StaffStatus,
  RepaymentSource,
} from '@welfare/shared';

const mockContribAggregate = jest.fn();
const mockLoanFind = jest.fn();
const mockLoanAggregate = jest.fn();
const mockLoanDistinct = jest.fn();
const mockLoanFindById = jest.fn();
const mockRepaymentFind = jest.fn();
const mockRepaymentAggregate = jest.fn();
const mockStaffFind = jest.fn();
const mockStaffFindById = jest.fn();
const mockBatchFind = jest.fn();

const mockContribModel = { aggregate: mockContribAggregate };
const mockLoanModel = { find: mockLoanFind, aggregate: mockLoanAggregate, distinct: mockLoanDistinct, findById: mockLoanFindById };
const mockRepaymentModel = { find: mockRepaymentFind, aggregate: mockRepaymentAggregate };
const mockStaffModel = { find: mockStaffFind, findById: mockStaffFindById };
const mockBatchModel = { find: mockBatchFind };

beforeEach(() => jest.clearAllMocks());

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: mockRepaymentModel },
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
        { provide: getModelToken(ImportBatch.name), useValue: mockBatchModel },
      ],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
  });

  // ─── CONTRIBUTION REPORTS ───

  describe('getMonthlyContributions', () => {
    it('returns aggregated rows with totals', async () => {
      mockContribAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            staffId: 'staff1',
            staffName: 'Alice',
            staffNo: 'GL001',
            expectedAmount: 100,
            paidAmount: 100,
            surplusCarriedForward: 0,
            status: ContributionStatus.Paid,
          },
        ]),
      });

      const result = await service.getMonthlyContributions(1, 2025);

      expect(result.month).toBe(1);
      expect(result.year).toBe(2025);
      expect(result.rows).toHaveLength(1);
      expect(result.totalExpected).toBe(100);
      expect(result.totalPaid).toBe(100);
    });
  });

  describe('getArrearsReport', () => {
    it('returns only missed/partial entries with shortfall', async () => {
      mockContribAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            staffId: 'staff2',
            staffName: 'Bob',
            staffNo: 'GL002',
            month: 2,
            year: 2025,
            expectedAmount: 100,
            paidAmount: 50,
            shortfall: 50,
            status: ContributionStatus.Partial,
          },
        ]),
      });

      const result = await service.getArrearsReport(1, 2025, 3, 2025);

      expect(result).toHaveLength(1);
      expect(result[0].shortfall).toBe(50);
    });
  });

  describe('getGuarantorOffsets', () => {
    it('returns repayments with guarantor source', async () => {
      mockRepaymentFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'rep1',
              loanId: 'loan1',
              staffId: 'borrower1',
              guarantorStaffId: 'guarantor1',
              instalmentNumber: 3,
              paidAmount: 200,
              paidDate: new Date('2025-03-05'),
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: { toString: () => 'borrower1' }, fullName: 'Borrower One', staffId: 'S001' },
          { _id: { toString: () => 'guarantor1' }, fullName: 'Guarantor One', staffId: 'S002' },
        ]),
      });

      const result = await service.getGuarantorOffsets();
      expect(result).toHaveLength(1);
      expect(result[0].offsetAmount).toBe(200);
    });

    it('returns empty array when no offset repayments exist', async () => {
      mockRepaymentFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });

      const result = await service.getGuarantorOffsets();
      expect(result).toHaveLength(0);
    });
  });

  // ─── LOAN REPORTS ───

  describe('getActiveLoans', () => {
    it('returns active loans with outstanding balance', async () => {
      mockLoanFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: { toString: () => 'loan1' },
              staffId: 'staff1',
              guarantorId: 'staff2',
              principalAmount: 5000,
              totalRepayable: 5500,
              disbursedDate: new Date('2025-01-01'),
            },
          ]),
        }),
      });
      // first find call for each loan's repayments
      mockRepaymentFind.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue([
          { dueAmount: 500, paidAmount: 0, dueDate: new Date('2025-06-05'), status: LoanRepaymentStatus.Pending },
        ]),
      });
      // second find for staff lookup
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: { toString: () => 'staff1' }, fullName: 'Alice', staffId: 'S001' },
          { _id: { toString: () => 'staff2' }, fullName: 'Bob', staffId: 'S002' },
        ]),
      });

      const result = await service.getActiveLoans();
      expect(result).toHaveLength(1);
      expect(result[0].outstandingBalance).toBe(500);
    });
  });

  describe('getOverdueLoans', () => {
    it('returns overdue instalments with daysOverdue', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);

      mockRepaymentFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'rep1',
              loanId: 'loan1',
              staffId: 'staff1',
              instalmentNumber: 2,
              dueDate: pastDate,
              dueAmount: 500,
              paidAmount: 0,
              penaltyAmount: 25,
              status: LoanRepaymentStatus.Overdue,
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: { toString: () => 'staff1' }, fullName: 'Alice', staffId: 'S001' },
        ]),
      });

      const result = await service.getOverdueLoans();
      expect(result).toHaveLength(1);
      expect(result[0].daysOverdue).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getRepaidLoans', () => {
    it('returns completed loans', async () => {
      mockLoanFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: { toString: () => 'loan2' },
              staffId: 'staff1',
              principalAmount: 3000,
              totalRepayable: 3300,
              settledAt: new Date('2025-04-01'),
              disbursedDate: new Date('2024-04-01'),
              tenureMonths: 12,
              status: LoanStatus.Completed,
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: { toString: () => 'staff1' }, fullName: 'Alice', staffId: 'S001' },
        ]),
      });

      const result = await service.getRepaidLoans();
      expect(result).toHaveLength(1);
      expect(result[0].totalRepayable).toBe(3300);
    });
  });

  describe('getBadDebt', () => {
    it('returns loans with BadDebt status', async () => {
      mockLoanFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: { toString: () => 'loan3' },
              staffId: 'staff1',
              principalAmount: 4000,
              totalRepayable: 4400,
              exitDeductionAmount: 1000,
              guarantorOffsetAmount: 500,
              badDebtAmount: 2900,
              settledAt: new Date('2025-05-01'),
              status: LoanStatus.BadDebt,
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: { toString: () => 'staff1' }, fullName: 'Alice', staffId: 'S001' },
        ]),
      });

      const result = await service.getBadDebt();
      expect(result).toHaveLength(1);
      expect(result[0].badDebtAmount).toBe(2900);
    });
  });

  // ─── STAFF + DASHBOARD ───

  describe('getExitClearanceReport', () => {
    it('returns non-active staff with outstanding balances', async () => {
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: { toString: () => 'staff3' }, fullName: 'Charlie', staffId: 'GL003', status: StaffStatus.Resigned },
        ]),
      });
      mockLoanFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: { toString: () => 'loan1' }, staffId: 'staff3', totalRepayable: 5000 },
        ]),
      });
      mockRepaymentFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { dueAmount: 500, paidAmount: 200, status: LoanRepaymentStatus.Overdue },
        ]),
      });
      mockContribAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ count: 2 }]),
      });

      const result = await service.getExitClearanceReport();
      expect(result).toHaveLength(1);
      expect(result[0].outstandingLoanBalance).toBe(300);
      expect(result[0].missedContributionsCount).toBe(2);
    });

    it('returns empty array when no exited staff', async () => {
      mockStaffFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      const result = await service.getExitClearanceReport();
      expect(result).toHaveLength(0);
    });
  });

  describe('getDashboardStats', () => {
    it('returns structured dashboard stats with current month', async () => {
      const now = new Date();

      // this month contrib aggregate
      mockContribAggregate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ _id: null, collected: 5000, expected: 6000 }]) })
        // loan status distribution
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ _id: LoanStatus.Active, count: 10 }]) })
        // outstanding aggregate (repaymentModel)
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }); // monthly trend months

      mockLoanAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: LoanStatus.Active, count: 10 },
          { _id: LoanStatus.Completed, count: 5 },
        ]),
      });
      mockRepaymentAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ _id: null, total: 50000 }]),
      });
      mockRepaymentFind
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) }) // overdue
        .mockReturnValueOnce({                                            // upcoming
          sort: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
          }),
        });
      mockBatchFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        }),
      });
      mockStaffFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      const result = await service.getDashboardStats();
      expect(result.thisMonth.month).toBe(now.getMonth() === 0 ? 12 : now.getMonth());
      expect(result.thisMonth.year).toBe(now.getFullYear());
      expect(result.loans.activeCount).toBe(10);
      expect(result.monthlyTrend).toHaveLength(12);
    });
  });

  // ─── CSV GENERATION ───

  describe('generateCsv', () => {
    it('returns CSV string with headers and data', async () => {
      const data = [{ name: 'Alice', amount: 100 }, { name: 'Bob', amount: 200 }];
      const csv = await service.generateCsv(data, ['name', 'amount']);
      expect(csv).toContain('name');
      expect(csv).toContain('Alice');
      expect(csv).toContain('200');
    });
  });

  // ─── LOAN STATEMENT ───

  describe('getLoanBorrowers', () => {
    it('returns borrowers sorted by displayName', async () => {
      mockLoanDistinct.mockResolvedValue(['staff2', 'staff1']);
      mockStaffFind.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              { _id: { toString: () => 'staff1' }, fullName: 'Alice', staffId: 'GL001' },
              { _id: { toString: () => 'staff2' }, fullName: 'Bob', staffId: 'GL002' },
            ]),
          }),
        }),
      });

      const result = await service.getLoanBorrowers();

      expect(result).toEqual([
        { staffId: 'staff1', staffNo: 'GL001', displayName: 'Alice' },
        { staffId: 'staff2', staffNo: 'GL002', displayName: 'Bob' },
      ]);
    });

    it('returns empty array when no loans exist', async () => {
      mockLoanDistinct.mockResolvedValue([]);
      const result = await service.getLoanBorrowers();
      expect(result).toEqual([]);
      expect(mockStaffFind).not.toHaveBeenCalled();
    });
  });

  describe('getLoanStatement', () => {
    const staffId = 'staff1';
    const loanId = 'loan1';

    const fakeLoan = {
      _id: { toString: () => loanId },
      staffId,
      guarantorId: 'guar1',
      principalAmount: 1000,
      interestRate: 5,
      totalRepayable: 1050,
      tenureMonths: 3,
      disbursedDate: new Date('2025-01-01'),
      status: 'Active',
      chequeNo: 'CHQ001',
      pvNo: 'PV001',
    };

    const fakeInstalments = [
      {
        instalmentNumber: 1,
        dueDate: new Date('2025-02-05'),
        dueAmount: 350,
        principalAmount: 333.33,
        interestAmount: 16.67,
        paidAmount: 350,
        penaltyAmount: 0,
        paidDate: new Date('2025-02-03'),
        status: LoanRepaymentStatus.Paid,
        source: 'DirectPayment',
      },
      {
        instalmentNumber: 2,
        dueDate: new Date('2025-03-05'),
        dueAmount: 350,
        principalAmount: 333.33,
        interestAmount: 16.67,
        paidAmount: 0,
        penaltyAmount: 0,
        status: LoanRepaymentStatus.Pending,
      },
      {
        instalmentNumber: 3,
        dueDate: new Date('2025-04-05'),
        dueAmount: 350,
        principalAmount: 333.34,
        interestAmount: 16.66,
        paidAmount: 0,
        penaltyAmount: 0,
        status: LoanRepaymentStatus.Pending,
      },
    ];

    beforeEach(() => {
      mockLoanFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(fakeLoan) });
      mockStaffFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ fullName: 'Alice', staffId: 'GL001', department: 'IT' }) });
      mockStaffFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: { toString: () => 'guar1' }, fullName: 'Bob', staffId: 'GL002' }]) });
      mockRepaymentFind.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(fakeInstalments) }) });
    });

    it('returns shaped statement with correct KPIs', async () => {
      const result = await service.getLoanStatement(staffId, loanId);

      expect(result.staff).toEqual({ staffNo: 'GL001', displayName: 'Alice', department: 'IT' });
      expect(result.loan.id).toBe(loanId);
      expect(result.loan.guarantor).toEqual({ staffNo: 'GL002', displayName: 'Bob' });
      expect(result.kpis.totalPaid).toBe(350);
      expect(result.kpis.outstanding).toBe(700);
      expect(result.kpis.penaltyPaid).toBe(0);
      expect(result.kpis.completionRate).toBe(33);
      expect(result.instalments).toHaveLength(3);
      expect(result.instalments[0].status).toBe(LoanRepaymentStatus.Paid);
    });

    it('throws BadRequestException when loan does not belong to staff', async () => {
      mockLoanFindById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...fakeLoan, staffId: 'other-staff' }),
      });

      await expect(service.getLoanStatement(staffId, loanId)).rejects.toThrow('Loan does not belong to this staff member');
    });

    it('throws NotFoundException when loan not found', async () => {
      mockLoanFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.getLoanStatement(staffId, loanId)).rejects.toThrow('Loan not found');
    });
  });
});
