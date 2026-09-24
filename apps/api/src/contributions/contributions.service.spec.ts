import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ContributionsService } from './contributions.service';
import { Contribution } from './schemas/contribution.schema';
import { Loan } from '../loans/schemas/loan.schema';
import { ContributionRatesService } from './contribution-rates.service';
import { AuditService } from '../audit/audit.service';
import { StaffService } from '../staff/staff.service';
import { ContributionStatus, ContributionSource } from '@welfare/shared';

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockFind = jest.fn();
const mockCountDocuments = jest.fn();
const mockAggregate = jest.fn();
const mockCreate = jest.fn();

const mockFindById = jest.fn();
const mockFindByIdAndDelete = jest.fn();
const mockExists = jest.fn();

const mockContributionModel = {
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
  find: mockFind,
  countDocuments: mockCountDocuments,
  aggregate: mockAggregate,
  create: mockCreate,
  findById: mockFindById,
  findByIdAndDelete: mockFindByIdAndDelete,
  exists: mockExists,
};

const mockLoanFindOne = jest.fn();
const mockLoanFindByIdAndUpdate = jest.fn();
const mockLoanFindOneAndUpdate = jest.fn();
const mockLoanUpdateOne = jest.fn();
const mockLoanModel = {
  findOne: mockLoanFindOne,
  findByIdAndUpdate: mockLoanFindByIdAndUpdate,
  findOneAndUpdate: mockLoanFindOneAndUpdate,
  updateOne: mockLoanUpdateOne,
};

// Simulates the atomic guarantor-restitution claim (loanModel.findOneAndUpdate)
// succeeding: the resolved doc reflects guarantorRestitutionPaid after the $inc.
function stubGuarantorClaimSucceeds(loan: Record<string, unknown>, redirectAmount: number) {
  mockLoanFindOneAndUpdate.mockReturnValue({
    exec: jest.fn().mockResolvedValue({
      ...loan,
      guarantorRestitutionPaid: ((loan.guarantorRestitutionPaid as number) ?? 0) + redirectAmount,
    }),
  });
}

const mockRatesService = { getRateFor: jest.fn().mockResolvedValue(3000) };

const mockAuditService = { log: jest.fn() };
const mockStaffService = { findManyByStaffIdPattern: jest.fn() };

describe('ContributionsService', () => {
  let service: ContributionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionsService,
        { provide: getModelToken(Contribution.name), useValue: mockContributionModel },
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: ContributionRatesService, useValue: mockRatesService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: StaffService, useValue: mockStaffService },
      ],
    }).compile();
    service = module.get<ContributionsService>(ContributionsService);
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
    mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockLoanFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockLoanFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockLoanUpdateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockRatesService.getRateFor.mockResolvedValue(3000);
  });

  describe('calculatePaymentResult (pure logic)', () => {
    it('marks Paid when totalCovered >= expectedAmount', () => {
      const result = service.calculatePaymentResult(0, 3000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('marks Partial when totalCovered < expectedAmount', () => {
      const result = service.calculatePaymentResult(0, 1000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Partial);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('calculates surplus when overpaid', () => {
      const result = service.calculatePaymentResult(0, 5000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(2000);
    });

    it('uses prevSurplus to reduce amount needed', () => {
      const result = service.calculatePaymentResult(0, 2500, 500, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('prevSurplus alone can cover full expected (no cash needed)', () => {
      const result = service.calculatePaymentResult(0, 0, 3500, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(500);
    });
  });

  describe('processPayment', () => {
    it('uses prevSurplus from previous month record', async () => {
      mockFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ surplusCarriedForward: 500 }) });
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      const result = await service.processPayment(
        'staff-mongo-id', 3, 2025, 2500, ContributionSource.PayrollImport, 'actor-id', 'Actor',
      );
      expect(result).toBe(savedDoc);
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { staffId: 'staff-mongo-id', month: 3, year: 2025 },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ContributionStatus.Paid,
            surplusCarriedForward: 0,
          }),
        }),
        expect.anything(),
      );
    });

    it('marks Partial when payment is insufficient', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      await service.processPayment('s1', 1, 2025, 1000, ContributionSource.ManualEntry, 'uid', 'U');
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: ContributionStatus.Partial }),
        }),
        expect.anything(),
      );
    });

    it('resolves the rate for the target month/year, not a fixed default', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });
      mockRatesService.getRateFor.mockResolvedValue(2500);

      await service.processPayment('s1', 3, 2022, 2500, ContributionSource.PayrollImport, 'uid', 'U');

      expect(mockRatesService.getRateFor).toHaveBeenCalledWith(3, 2022);
    });
  });

  describe('processLumpSum', () => {
    it('processes single month when amount covers only one month', async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const savedDoc = { _id: { toString: () => 'c-id' }, surplusCarriedForward: 0, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      const results = await service.processLumpSum('s1', 2500, 3, 2025, 'uid', 'U');
      expect(results).toHaveLength(1);
    });

    it('splits across multiple months when amount is large', async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { month: 1, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
          { month: 2, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
        ]),
      });
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const mockSaved = { _id: { toString: () => 'c-id' }, surplusCarriedForward: 0, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) });

      const results = await service.processLumpSum('s1', 6000, 1, 2025, 'uid', 'U');
      expect(results).toHaveLength(2);
      expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
    });

    it('looks up the rate for each month in the backfill loop', async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { month: 1, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
          { month: 2, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
        ]),
      });
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const mockSaved = { _id: { toString: () => 'c-id' }, surplusCarriedForward: 0, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) });

      await service.processLumpSum('s1', 6000, 1, 2025, 'uid', 'U');

      expect(mockRatesService.getRateFor).toHaveBeenCalledWith(1, 2025);
      expect(mockRatesService.getRateFor).toHaveBeenCalledWith(2, 2025);
    });
  });

  describe('debitDefaulterContribution', () => {
    it('debits full amount when balance is sufficient', async () => {
      mockAggregate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: 10000 }]) }) // credits
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });                 // debits (none)

      const result = await service.debitDefaulterContribution('staff-1', 3000, 'actor-id', 'Actor');

      expect(result).toEqual({ debited: 3000, remaining: 0 });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          staffId: 'staff-1',
          paidAmount: 3000,
          isDebit: true,
          source: ContributionSource.DefaulterDeduction,
        }),
      );
    });

    it('debits partial amount when balance is insufficient', async () => {
      mockAggregate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: 1000 }]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });

      const result = await service.debitDefaulterContribution('staff-1', 3000, 'actor-id', 'Actor');

      expect(result).toEqual({ debited: 1000, remaining: 2000 });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ paidAmount: 1000 }),
      );
    });

    it('creates no entry and returns debited=0 when balance is zero', async () => {
      mockAggregate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) })  // no credits
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) }); // no debits

      const result = await service.debitDefaulterContribution('staff-1', 3000, 'actor-id', 'Actor');

      expect(result).toEqual({ debited: 0, remaining: 3000 });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('handleRestitutionRedirect (via processPayment)', () => {
    const makeRestitutionLoan = (owed: number, paid: number) => ({
      _id: { toString: () => 'loan-1' },
      staffId: 'staff-1',
      guarantorId: 'guarantor-1',
      status: 'Defaulted',
      guarantorRestitutionOwed: owed,
      guarantorRestitutionPaid: paid,
    });

    beforeEach(() => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'c-1' }, toObject: () => ({}) }) });
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      mockLoanFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    });

    it('creates debit+credit entries and increments guarantorRestitutionPaid when restitution is active', async () => {
      const loan = makeRestitutionLoan(5000, 0);
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      stubGuarantorClaimSucceeds(loan, 3000);

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ staffId: 'staff-1', isDebit: true, source: ContributionSource.DefaulterRestitution, paidAmount: 3000, loanId: 'loan-1' }),
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ staffId: 'guarantor-1', isDebit: false, source: ContributionSource.DefaulterRestitution, paidAmount: 3000, loanId: 'loan-1', borrowerStaffId: 'staff-1' }),
      );
      expect(mockLoanFindOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: loan._id,
          $expr: { $gte: [{ $subtract: ['$guarantorRestitutionOwed', '$guarantorRestitutionPaid'] }, 3000] },
        },
        { $inc: { guarantorRestitutionPaid: 3000 } },
        { new: true },
      );
    });

    it('marks recoveredAt when guarantor restitution is fully paid and there is no bad debt', async () => {
      const loan = { ...makeRestitutionLoan(640, 0), badDebtAmount: 0 };
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      stubGuarantorClaimSucceeds(loan, 640);

      await service.processPayment('staff-1', 1, 2026, 640, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockLoanUpdateOne).toHaveBeenCalledWith(
        { _id: loan._id },
        { $set: { recoveredAt: expect.any(Date) } },
      );
    });

    it('does not mark recoveredAt when guarantor restitution is only partially paid', async () => {
      const loan = { ...makeRestitutionLoan(640, 0), badDebtAmount: 0 };
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      stubGuarantorClaimSucceeds(loan, 200);

      await service.processPayment('staff-1', 1, 2026, 200, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockLoanFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { guarantorRestitutionPaid: 200 } },
        { new: true },
      );
      expect(mockLoanUpdateOne).not.toHaveBeenCalled();
    });

    it('does not mark recoveredAt on guarantor payoff when the loan still carries bad debt', async () => {
      const loan = { ...makeRestitutionLoan(640, 0), badDebtAmount: 500 };
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      stubGuarantorClaimSucceeds(loan, 640);

      await service.processPayment('staff-1', 1, 2026, 640, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockLoanFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { guarantorRestitutionPaid: 640 } },
        { new: true },
      );
      expect(mockLoanUpdateOne).not.toHaveBeenCalled();
    });

    it('caps redirect at remaining restitution owed', async () => {
      const loan = makeRestitutionLoan(5000, 4500);
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      stubGuarantorClaimSucceeds(loan, 500);

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ paidAmount: 500 }),
      );
    });

    it('does not credit the guarantor or debit the payer when the atomic claim loses a race', async () => {
      const loan = makeRestitutionLoan(5000, 0);
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      mockLoanFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }); // another redirect claimed it first

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({ source: ContributionSource.DefaulterRestitution }),
      );
      expect(mockLoanUpdateOne).not.toHaveBeenCalled();
    });

    it('skips redirect when no active restitution loan', async () => {
      mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockCreate).not.toHaveBeenCalled();
    });

    const makeBadDebtLoan = (badDebtAmount: number, badDebtRecovered: number) => ({
      _id: { toString: () => 'loan-2' },
      staffId: 'staff-1',
      status: 'Defaulted',
      badDebtAmount,
      badDebtRecovered,
    });

    it('redirects payment to bad debt recovery once guarantor is fully restituted', async () => {
      mockLoanFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }) // no guarantor restitution owed
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(makeBadDebtLoan(4000, 1000)) });

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ staffId: 'staff-1', isDebit: true, source: ContributionSource.BadDebtRecovery, paidAmount: 3000, loanId: 'loan-2' }),
      );
      expect(mockLoanFindByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { badDebtRecovered: 3000 }, $set: { recoveredAt: expect.any(Date) } },
      );
    });

    it('caps bad debt redirect at the remaining unrecovered amount and marks recoveredAt when fully caught up', async () => {
      mockLoanFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(makeBadDebtLoan(4000, 3500)) });

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ paidAmount: 500, source: ContributionSource.BadDebtRecovery }),
      );
      expect(mockLoanFindByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { badDebtRecovered: 500 }, $set: { recoveredAt: expect.any(Date) } },
      );
    });

    it('does not mark recoveredAt when the redirect only partially covers remaining bad debt', async () => {
      mockLoanFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(makeBadDebtLoan(4000, 0)) });

      await service.processPayment('staff-1', 1, 2026, 1000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockLoanFindByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { badDebtRecovered: 1000 } },
      );
    });

    it('only redirects the leftover after guarantor restitution consumes part of the payment', async () => {
      const restitutionLoan = makeRestitutionLoan(1000, 0);
      mockLoanFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(restitutionLoan) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(makeBadDebtLoan(4000, 0)) });
      stubGuarantorClaimSucceeds(restitutionLoan, 1000);

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ source: ContributionSource.DefaulterRestitution, paidAmount: 1000, isDebit: true }),
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ source: ContributionSource.DefaulterRestitution, paidAmount: 1000, isDebit: false }),
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ source: ContributionSource.BadDebtRecovery, paidAmount: 2000 }),
      );
    });

    it('does not query bad debt recovery when guarantor restitution consumes the entire payment', async () => {
      const restitutionLoan = makeRestitutionLoan(5000, 0);
      mockLoanFindOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(restitutionLoan) });
      stubGuarantorClaimSucceeds(restitutionLoan, 3000);

      await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

      expect(mockLoanFindOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('redirectLoanPaymentToGuarantor', () => {
    const makeLoan = (owed: number, paid: number, badDebtAmount = 0) => ({
      _id: { toString: () => 'loan-1' },
      staffId: 'staff-1',
      guarantorId: 'guarantor-1',
      guarantorRestitutionOwed: owed,
      guarantorRestitutionPaid: paid,
      badDebtAmount,
    });

    beforeEach(() => {
      mockLoanFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      mockLoanUpdateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    });

    it('credits the guarantor and returns the leftover when the payment exceeds what is owed', async () => {
      const loan = makeLoan(1000, 0) as any;
      stubGuarantorClaimSucceeds(loan, 1000);

      const leftover = await service.redirectLoanPaymentToGuarantor(loan, 3500, 'actor-id', 'Actor');

      expect(leftover).toBe(2500);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          staffId: 'guarantor-1',
          isDebit: false,
          source: ContributionSource.DefaulterRestitution,
          paidAmount: 1000,
          loanId: 'loan-1',
          borrowerStaffId: 'staff-1',
        }),
      );
      expect(mockLoanFindOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: loan._id,
          $expr: { $gte: [{ $subtract: ['$guarantorRestitutionOwed', '$guarantorRestitutionPaid'] }, 1000] },
        },
        { $inc: { guarantorRestitutionPaid: 1000 } },
        { new: true },
      );
      expect(mockLoanUpdateOne).toHaveBeenCalledWith(
        { _id: loan._id },
        { $set: { recoveredAt: expect.any(Date) } },
      );
    });

    it('caps the redirect at what remains owed and returns the correct leftover', async () => {
      const loan = makeLoan(2000, 1500) as any; // remaining owed = 500
      stubGuarantorClaimSucceeds(loan, 500);

      const leftover = await service.redirectLoanPaymentToGuarantor(loan, 3000, 'actor-id', 'Actor');

      expect(leftover).toBe(2500);
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ paidAmount: 500 }));
      expect(mockLoanUpdateOne).toHaveBeenCalledWith(
        { _id: loan._id },
        { $set: { recoveredAt: expect.any(Date) } },
      );
    });

    it('returns the full amount unchanged and touches nothing when nothing is owed', async () => {
      const loan = makeLoan(0, 0) as any;

      const leftover = await service.redirectLoanPaymentToGuarantor(loan, 3500, 'actor-id', 'Actor');

      expect(leftover).toBe(3500);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockLoanFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns the full amount unchanged when restitution is already fully paid', async () => {
      const loan = makeLoan(1000, 1000) as any; // owed - paid = 0

      const leftover = await service.redirectLoanPaymentToGuarantor(loan, 500, 'actor-id', 'Actor');

      expect(leftover).toBe(500);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('does not mark recoveredAt when the loan still carries bad debt', async () => {
      const loan = makeLoan(1000, 0, 500) as any; // badDebtAmount = 500
      stubGuarantorClaimSucceeds(loan, 1000);

      await service.redirectLoanPaymentToGuarantor(loan, 1000, 'actor-id', 'Actor');

      expect(mockLoanUpdateOne).not.toHaveBeenCalled();
    });

    it('does not mark recoveredAt when only partially restituted', async () => {
      const loan = makeLoan(1000, 0) as any;
      stubGuarantorClaimSucceeds(loan, 300);

      await service.redirectLoanPaymentToGuarantor(loan, 300, 'actor-id', 'Actor');

      expect(mockLoanUpdateOne).not.toHaveBeenCalled();
    });

    it('does not credit the guarantor when the atomic claim loses a race to a concurrent redirect', async () => {
      const loan = makeLoan(1000, 0) as any;
      mockLoanFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }); // another redirect claimed it first

      const leftover = await service.redirectLoanPaymentToGuarantor(loan, 500, 'actor-id', 'Actor');

      expect(leftover).toBe(500);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockLoanUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe('bulkDeleteContributions', () => {
    it('deletes each contribution by id and reports the count', async () => {
      const c1 = { _id: 'c1', toObject: () => ({ id: 'c1' }) };
      const c2 = { _id: 'c2', toObject: () => ({ id: 'c2' }) };
      mockFindById
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(c1) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(c2) });
      mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });

      const result = await service.bulkDeleteContributions(['c1', 'c2'], 'actor-id', 'Actor');

      expect(result).toEqual({ deleted: 2 });
      expect(mockFindByIdAndDelete).toHaveBeenCalledTimes(2);
      expect(mockAuditService.log).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException and stops when an id does not exist', async () => {
      mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.bulkDeleteContributions(['missing'], 'actor-id', 'Actor')).rejects.toThrow('Contribution missing not found');
    });
  });

  describe('hasContributionsForLoan', () => {
    it('returns true when a Contribution row references the loanId', async () => {
      mockExists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'c1' }) });

      const result = await service.hasContributionsForLoan('loan-1');

      expect(mockExists).toHaveBeenCalledWith({ loanId: 'loan-1' });
      expect(result).toBe(true);
    });

    it('returns false when no Contribution row references the loanId', async () => {
      mockExists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const result = await service.hasContributionsForLoan('loan-1');

      expect(result).toBe(false);
    });
  });
});
