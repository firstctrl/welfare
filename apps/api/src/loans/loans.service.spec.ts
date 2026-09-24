import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LoansService } from './loans.service';
import { Loan } from './schemas/loan.schema';
import { LoanRepayment } from './schemas/loan-repayment.schema';
import { Discount } from './schemas/discount.schema';
import { StaffService } from '../staff/staff.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionsService } from '../contributions/contributions.service';
import { MINIO_CLIENT } from '../storage/minio.module';
import { AuditAction, AuditEntity, LoanStatus, LoanRepaymentStatus, PaymentEntryType, RepaymentSource, StaffStatus } from '@welfare/shared';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ExitSettlementDto } from './dto/exit-settlement.dto';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';

const activeStaff = (id: string, staffId = 'SF001') => ({
  _id: { toString: () => id },
  staffId,
  status: StaffStatus.Active,
  dateOfEmployment: new Date('2020-01-01'),
  fullName: 'Test Staff',
  toObject: () => ({ _id: id, staffId, status: StaffStatus.Active }),
});

const mockConfig = () => ({
  LOAN_MIN_AMOUNT: { value: '500' },
  LOAN_MAX_AMOUNT: { value: '50000' },
  LOAN_MAX_TENURE: { value: '12' },
  INTEREST_RATE_SHORT: { value: '5' },
  INTEREST_RATE_LONG: { value: '8' },
  ELIGIBILITY_MONTHS: { value: '6' },
  PENALTY_TYPE: { value: 'Fixed' },
  PENALTY_VALUE: { value: '500' },
  MAX_LOANS_PER_GUARANTOR: { value: '3' },
  GRACE_PERIOD_DAYS: { value: '0' },
});

describe('LoansService', () => {
  let service: LoansService;
  let loanModel: any;
  let repaymentModel: any;
  let staffService: any;
  let configService: any;
  let auditService: any;
  let contributionsService: any;
  let minioClient: any;
  let discountModel: any;

  beforeEach(async () => {
    loanModel = {
      findByIdAndDelete: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    repaymentModel = {
      insertMany: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
      exists: jest.fn(),
      deleteMany: jest.fn(),
    };
    staffService = { findById: jest.fn().mockResolvedValue(activeStaff('staff-123')) };
    configService = { getAll: jest.fn() };
    auditService = { log: jest.fn() };
    contributionsService = {
      debitGuarantorOffset: jest.fn(),
      debitDefaulterContribution: jest.fn().mockResolvedValue({ debited: 0, remaining: 0 }),
      settleGuarantorRestitution: jest.fn().mockResolvedValue(0),
      redirectLoanPaymentToGuarantor: jest.fn().mockImplementation(async (_loan: unknown, amount: number) => amount),
    };
    minioClient = { putObject: jest.fn(), presignedGetObject: jest.fn() };
    discountModel = {
      create: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: getModelToken(Discount.name), useValue: discountModel },
        { provide: StaffService, useValue: staffService },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
        { provide: MINIO_CLIENT, useValue: minioClient },
        { provide: LoanScheduleSenderService, useValue: { sendForLoan: jest.fn().mockResolvedValue(undefined) } },
        { provide: MEILISEARCH_CLIENT, useValue: { index: jest.fn().mockReturnValue({ addDocuments: jest.fn().mockResolvedValue(undefined), deleteDocument: jest.fn().mockResolvedValue(undefined), updateSettings: jest.fn().mockResolvedValue(undefined) }) } },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
    jest.clearAllMocks();
    loanModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  });

  describe('create', () => {
    const dto = {
      staffId: 'staff-mongo-id',
      guarantorId: 'guarantor-mongo-id',
      principalAmount: 10000,
      tenureMonths: 3,
      disbursedDate: '2026-03-15',
      chequeNo: 'CHQ-001',
      pvNo: 'PV-001',
    };

    it('creates loan with correct totalRepayable and schedule', async () => {
      staffService.findById
        .mockResolvedValueOnce(activeStaff('staff-mongo-id', 'SF001'))
        .mockResolvedValueOnce(activeStaff('guarantor-mongo-id', 'SF002'));

      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      loanModel.countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      configService.getAll.mockResolvedValue(mockConfig());

      const savedLoan = {
        _id: { toString: () => 'loan-id' },
        staffId: 'staff-mongo-id',
        principalAmount: 10000,
        interestRate: 5,
        totalRepayable: 10500,
        monthlyInstalment: 3500,
        tenureMonths: 3,
        disbursedDate: new Date('2026-03-15'),
        status: LoanStatus.Active,
        toObject: () => ({}),
      };

      loanModel.create.mockResolvedValue(savedLoan);
      repaymentModel.insertMany.mockResolvedValue([]);

      const result = await service.create(dto, 'actor-id', 'Actor');

      expect(loanModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          principalAmount: 10000,
          interestRate: 5,
          totalRepayable: 10500,
          monthlyInstalment: 3500,
          tenureMonths: 3,
        }),
      );
      expect(repaymentModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            instalmentNumber: 1,
            dueAmount: 3500,
            principalAmount: 3333.33,
            interestAmount: 166.67,
            status: LoanRepaymentStatus.Pending,
          }),
          expect.objectContaining({ instalmentNumber: 2, principalAmount: 3333.33, interestAmount: 166.67 }),
          expect.objectContaining({ instalmentNumber: 3, principalAmount: 3333.34, interestAmount: 166.66 }),
        ]),
      );
      const [firstInstalment] = (repaymentModel.insertMany.mock.calls[0] as any[][])[0];
      expect(new Date(firstInstalment.dueDate).getDate()).toBe(5);
      expect(new Date(firstInstalment.dueDate).getMonth()).toBe(3); // April = 3
      expect(result).toBe(savedLoan);
    });

    it('throws BadRequestException when staff is not Active', async () => {
      staffService.findById.mockResolvedValueOnce({ ...activeStaff('staff-mongo-id'), status: StaffStatus.Resigned });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when staff already has an active loan', async () => {
      staffService.findById.mockResolvedValueOnce(activeStaff('staff-mongo-id'));
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: 'existing-loan' }) });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when employment below threshold', async () => {
      staffService.findById.mockResolvedValueOnce({ ...activeStaff('staff-mongo-id'), dateOfEmployment: new Date() });
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when guarantorId equals staffId', async () => {
      const sameId = { ...dto, guarantorId: dto.staffId };
      staffService.findById.mockResolvedValueOnce(activeStaff('staff-mongo-id'));
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(sameId, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when guarantor is not Active', async () => {
      staffService.findById
        .mockResolvedValueOnce(activeStaff('staff-mongo-id'))
        .mockResolvedValueOnce({ ...activeStaff('guarantor-mongo-id'), status: StaffStatus.Retired });
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      loanModel.countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when amount below configured minimum', async () => {
      staffService.findById
        .mockResolvedValueOnce(activeStaff('staff-mongo-id'))
        .mockResolvedValueOnce(activeStaff('guarantor-mongo-id'));
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      loanModel.countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      configService.getAll.mockResolvedValue({ ...mockConfig(), LOAN_MIN_AMOUNT: { value: '20000' } });
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });
  });

  describe('createForLegacyImport', () => {
    const instalments = [
      {
        instalmentNumber: 1,
        dueDate: new Date('2025-01-05'),
        dueAmount: 3000,
        paidAmount: 3000,
        paidDate: new Date('2025-01-04'),
        status: LoanRepaymentStatus.Paid,
      },
      {
        instalmentNumber: 2,
        dueDate: new Date('2025-02-05'),
        dueAmount: 3000,
        paidAmount: 0,
        status: LoanRepaymentStatus.Pending,
      },
    ];
    const dto = {
      principalAmount: 5000,
      tenureMonths: 2,
      disbursedDate: '2024-12-15',
      status: LoanStatus.Active,
      cutoverDate: '2026-01-01',
      guarantorRestitutionOwed: 800,
      guarantorRestitutionPaid: 200,
      chequeNo: 'CHQ-L1',
      pvNo: 'PV-L1',
    };

    it('creates a legacy loan with the legacy flag, cutover date, and restitution figures set directly from input', async () => {
      loanModel.create.mockResolvedValue({ _id: { toString: () => 'loan-legacy-1' } });
      repaymentModel.insertMany.mockResolvedValue([]);

      await service.createForLegacyImport('staff-1', 'guarantor-1', dto, instalments, 'actor-1', 'Actor');

      expect(loanModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          staffId: 'staff-1',
          guarantorId: 'guarantor-1',
          legacy: true,
          legacyCutoverDate: new Date('2026-01-01'),
          guarantorRestitutionOwed: 800,
          guarantorRestitutionPaid: 200,
          status: LoanStatus.Active,
          totalRepayable: 6000,
          monthlyInstalment: 3000,
        }),
      );
    });

    it('inserts instalments exactly as given, trusting status/paidAmount/dueDate rather than recomputing a schedule', async () => {
      loanModel.create.mockResolvedValue({ _id: { toString: () => 'loan-legacy-1' } });
      repaymentModel.insertMany.mockResolvedValue([]);

      await service.createForLegacyImport('staff-1', 'guarantor-1', dto, instalments, 'actor-1', 'Actor');

      const inserted = repaymentModel.insertMany.mock.calls[0][0];
      expect(inserted).toHaveLength(2);
      expect(inserted[0]).toEqual(
        expect.objectContaining({
          loanId: 'loan-legacy-1',
          instalmentNumber: 1,
          dueAmount: 3000,
          paidAmount: 3000,
          status: LoanRepaymentStatus.Paid,
          source: RepaymentSource.Import,
        }),
      );
      expect(inserted[1]).toEqual(
        expect.objectContaining({
          instalmentNumber: 2,
          paidAmount: 0,
          status: LoanRepaymentStatus.Pending,
          source: undefined,
        }),
      );
    });
  });

  describe('recordPayment', () => {
    const loanId = 'loan-id';
    const dto: RecordPaymentDto = { amount: 3500, paidDate: '2026-04-10', notes: undefined };

    const makeLoan = (status = LoanStatus.Active) => ({
      _id: { toString: () => loanId },
      status,
      toObject: () => ({}),
    });

    const makeInstalment = (
      n: number,
      status: LoanRepaymentStatus,
      paidAmount = 0,
      penaltyAmount = 0,
      dueDate = new Date('2026-04-05'),
    ) => ({
      _id: { toString: () => `inst-${n}` },
      instalmentNumber: n,
      dueDate,
      dueAmount: 3500,
      paidAmount,
      penaltyAmount,
      status,
      payments: [] as any[],
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks instalment Paid when payment equals dueAmount', async () => {
      const inst = makeInstalment(1, LoanRepaymentStatus.Pending);
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(inst.save).toHaveBeenCalled();
      expect(inst.status).toBe(LoanRepaymentStatus.Paid);
      expect(inst.paidAmount).toBe(3500);
    });

    it('appends a payment entry recording who and when', async () => {
      const inst = makeInstalment(1, LoanRepaymentStatus.Pending);
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());

      await service.recordPayment(loanId, dto, 'actor-1', 'Ama Officer');

      expect(inst.payments).toHaveLength(1);
      expect(inst.payments[0]).toMatchObject({
        amount: 3500,
        recordedById: 'actor-1',
        recordedByName: 'Ama Officer',
        type: 'Payment',
      });
      expect(new Date(inst.payments[0].paidDate).toISOString().slice(0, 10)).toBe('2026-04-10');
    });

    it('appends a second payment entry without discarding the first', async () => {
      const inst = makeInstalment(1, LoanRepaymentStatus.Partial, 1000);
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      inst.payments.push({ amount: 1000, recordedById: 'actor-0', recordedByName: 'Prior Officer', type: 'Payment' });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());

      await service.recordPayment(loanId, { amount: 2500, paidDate: '2026-04-10' }, 'actor-1', 'Ama Officer');

      expect(inst.payments).toHaveLength(2);
      expect(inst.payments[0].recordedByName).toBe('Prior Officer');
      expect(inst.payments[1]).toMatchObject({ amount: 2500, recordedByName: 'Ama Officer', type: 'Payment' });
    });

    it('carries surplus to next instalment when overpaying', async () => {
      const inst1 = makeInstalment(1, LoanRepaymentStatus.Pending);
      const inst2 = makeInstalment(2, LoanRepaymentStatus.Pending);
      const overpayDto: RecordPaymentDto = { amount: 5000, paidDate: '2026-04-10' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst1, inst2]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());

      await service.recordPayment(loanId, overpayDto, 'actor', 'Actor');

      expect(inst1.status).toBe(LoanRepaymentStatus.Paid);
      expect(inst1.paidAmount).toBe(3500);
      expect(inst2.status).toBe(LoanRepaymentStatus.Partial);
      expect(inst2.paidAmount).toBe(1500);
    });

    it('applies penalty when paying an Overdue instalment after dueDate', async () => {
      const overdueInst = makeInstalment(1, LoanRepaymentStatus.Overdue, 0, 0, new Date('2026-04-05'));
      const latePayDto: RecordPaymentDto = { amount: 4000, paidDate: '2026-04-20' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([overdueInst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());

      await service.recordPayment(loanId, latePayDto, 'actor', 'Actor');

      expect(overdueInst.penaltyAmount).toBe(500);
      expect(overdueInst.paidAmount).toBe(4000);
      expect(overdueInst.status).toBe(LoanRepaymentStatus.Paid);
    });

    it('marks loan Completed when all instalments are Paid', async () => {
      const inst = makeInstalment(1, LoanRepaymentStatus.Pending);
      const completedLoan = { ...makeLoan(), status: LoanStatus.Completed, staffId: 'staff-123' };
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());
      loanModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(completedLoan) });

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(loanModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: loanId, status: LoanStatus.Active },
        { $set: { status: LoanStatus.Completed } },
        { new: true },
      );
    });

    it('does not mark Completed when loan is already Defaulted', async () => {
      const defaultedLoan = { ...makeLoan(), status: LoanStatus.Defaulted };
      const inst = makeInstalment(1, LoanRepaymentStatus.Overdue);
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(defaultedLoan) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());
      loanModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(loanModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: loanId, status: LoanStatus.Active },
        { $set: { status: LoanStatus.Completed } },
        { new: true },
      );
      const completionAudit = auditService.log.mock.calls.find(
        (c: any[]) => c[6]?.status === LoanStatus.Completed,
      );
      expect(completionAudit).toBeUndefined();
    });

    it('throws NotFoundException when loan does not exist', async () => {
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.recordPayment('missing', dto, 'actor', 'Actor')).rejects.toThrow(NotFoundException);
    });
  });

  describe('recordPayment — guarantor restitution redirect', () => {
    const loanId = 'loan-id';

    const makeLoan = (owed: number, paid: number, status = LoanStatus.Active) => ({
      _id: { toString: () => loanId },
      staffId: 'staff-123',
      status,
      guarantorRestitutionOwed: owed,
      guarantorRestitutionPaid: paid,
      toObject: () => ({}),
    });

    const makeInstalment = (dueAmount: number, paidAmount = 0) => ({
      _id: { toString: () => 'inst-1' },
      instalmentNumber: 1,
      dueDate: new Date('2026-04-05'),
      dueAmount,
      paidAmount,
      penaltyAmount: 0,
      status: LoanRepaymentStatus.Pending,
      payments: [] as any[],
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('redirects the payment through the guarantor restitution helper before allocating to instalments', async () => {
      const loan = makeLoan(1000, 0);
      const inst = makeInstalment(3500);
      const dto: RecordPaymentDto = { amount: 3500, paidDate: '2026-04-10' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());
      contributionsService.redirectLoanPaymentToGuarantor.mockResolvedValue(2500); // 1000 redirected, 2500 left

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(contributionsService.redirectLoanPaymentToGuarantor).toHaveBeenCalledWith(loan, 3500, 'actor', 'Actor');
      expect(inst.paidAmount).toBe(2500);
      expect(inst.status).toBe(LoanRepaymentStatus.Partial);
    });

    it('applies the full payment to instalments unchanged when no restitution is owed', async () => {
      const loan = makeLoan(0, 0);
      const inst = makeInstalment(3500);
      const dto: RecordPaymentDto = { amount: 3500, paidDate: '2026-04-10' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());
      // default mock already passes amount through unchanged

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(contributionsService.redirectLoanPaymentToGuarantor).toHaveBeenCalledWith(loan, 3500, 'actor', 'Actor');
      expect(inst.paidAmount).toBe(3500);
      expect(inst.status).toBe(LoanRepaymentStatus.Paid);
    });

    it('touches no instalment when the entire payment is redirected to the guarantor', async () => {
      const loan = makeLoan(5000, 0);
      const inst = makeInstalment(3500);
      const dto: RecordPaymentDto = { amount: 3500, paidDate: '2026-04-10' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());
      contributionsService.redirectLoanPaymentToGuarantor.mockResolvedValue(0); // fully redirected

      const result = await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(result).toEqual([]);
      expect(inst.save).not.toHaveBeenCalled();
      expect(inst.paidAmount).toBe(0);
    });

    it('redirects, completes the loan in the same call, and still runs the lump-sum settlement without double-crediting', async () => {
      const callOrder: string[] = [];
      const loan = makeLoan(1000, 700); // 300 still owed going into this payment
      const inst = makeInstalment(3200); // exactly what remains after redirect
      const dto: RecordPaymentDto = { amount: 3500, paidDate: '2026-04-10' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());
      contributionsService.redirectLoanPaymentToGuarantor.mockImplementation(async () => {
        callOrder.push('redirect');
        return 3200; // 300 redirected (caps at remaining owed), 3200 left
      });
      contributionsService.settleGuarantorRestitution.mockImplementation(async () => {
        callOrder.push('settle');
        return 0; // nothing left — incremental redirect already covered it
      });
      loanModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...loan, status: LoanStatus.Completed }),
      });

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(inst.paidAmount).toBe(3200);
      expect(inst.status).toBe(LoanRepaymentStatus.Paid);
      expect(contributionsService.settleGuarantorRestitution).toHaveBeenCalledWith(loanId, 'actor', 'Actor');
      expect(callOrder).toEqual(['redirect', 'settle']);
    });

    it('does not redirect imported payments — only direct borrower payments trigger the redirect', async () => {
      const loan = makeLoan(1000, 0);
      const inst = makeInstalment(3500);

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());

      await service.recordPaymentInternal(
        loanId,
        { amount: 3500, paidDate: '2026-04-10' },
        RepaymentSource.Import,
        'actor',
        'Actor',
      );

      expect(contributionsService.redirectLoanPaymentToGuarantor).not.toHaveBeenCalled();
      expect(inst.paidAmount).toBe(3500);
      expect(inst.status).toBe(LoanRepaymentStatus.Paid);
    });

    it('records how much of the payment was redirected to the guarantor in the audit log', async () => {
      const loan = makeLoan(1000, 0);
      const inst = makeInstalment(3500);
      const dto: RecordPaymentDto = { amount: 3500, paidDate: '2026-04-10' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue(mockConfig());
      contributionsService.redirectLoanPaymentToGuarantor.mockResolvedValue(2500); // 1000 redirected

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(auditService.log).toHaveBeenCalledWith(
        'actor',
        'Actor',
        AuditAction.RecordPayment,
        AuditEntity.Loan,
        loanId,
        undefined,
        { amount: 3500, paidDate: '2026-04-10', source: RepaymentSource.DirectPayment, redirectedToGuarantor: 1000 },
      );
    });
  });

  describe('deleteRepayment', () => {
    const loanId = 'loan-id';
    const repaymentId = 'repayment-id';

    const makeRepayment = (overrides: Record<string, unknown> = {}) => ({
      _id: repaymentId,
      loanId,
      dueDate: new Date('2026-04-05'),
      paidAmount: 3500,
      status: LoanRepaymentStatus.Paid,
      paidDate: new Date('2026-04-10'),
      source: RepaymentSource.DirectPayment,
      payments: [{ amount: 3500, recordedById: 'actor-1', recordedByName: 'Ama Officer', type: 'Payment' }] as any[],
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it('appends a Reversal entry instead of discarding history', async () => {
      const repayment = makeRepayment();
      repaymentModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(repayment) });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ status: LoanStatus.Active }) });

      await service.deleteRepayment(loanId, repaymentId, 'actor-2', 'Kofi Manager');

      expect(repayment.payments).toHaveLength(2);
      expect(repayment.payments[1]).toMatchObject({
        amount: -3500,
        recordedById: 'actor-2',
        recordedByName: 'Kofi Manager',
        type: 'Reversal',
      });
    });
  });

  describe('exitSettle', () => {
    const loanId = 'loan-id';

    const makeLoan = (guarantorId = 'guarantor-id') => ({
      _id: { toString: () => loanId },
      guarantorId,
      status: LoanStatus.Active,
      toObject: () => ({}),
    });

    const makeInstalment = (
      n: number,
      paidAmount = 0,
      penaltyAmount = 0,
      status = LoanRepaymentStatus.Pending,
    ) => ({
      _id: { toString: () => `inst-${n}` },
      instalmentNumber: n,
      dueAmount: 3500,
      paidAmount,
      penaltyAmount,
      status,
      payments: [] as any[],
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks loan Completed when exitDeductionAmount covers full outstanding', async () => {
      const insts = [makeInstalment(1), makeInstalment(2), makeInstalment(3)];
      const dto: ExitSettlementDto = { exitDeductionAmount: 10500 };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue(insts) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.exitSettle(loanId, dto, 'actor', 'Actor');

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        loanId,
        expect.objectContaining({
          $set: expect.objectContaining({ status: LoanStatus.Completed, exitDeductionAmount: 10500 }),
        }),
        { new: true },
      );
      insts.forEach((i) => expect(i.save).toHaveBeenCalled());
    });

    it('uses guarantor offset when deduction is insufficient', async () => {
      const insts = [makeInstalment(1), makeInstalment(2)];
      const dto: ExitSettlementDto = { exitDeductionAmount: 4000 };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(insts) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 3000, remaining: 0 });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.exitSettle(loanId, dto, 'actor', 'Actor');

      expect(contributionsService.debitGuarantorOffset).toHaveBeenCalledWith(
        'guarantor-id', 3000, loanId, 'actor', 'Actor',
      );
      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        loanId,
        expect.objectContaining({
          $set: expect.objectContaining({
            status: LoanStatus.Completed,
            guarantorOffsetAmount: 3000,
            badDebtAmount: 0,
          }),
        }),
        { new: true },
      );
    });

    it('sets status BadDebt when guarantor offset still leaves a remainder', async () => {
      const insts = [makeInstalment(1), makeInstalment(2)];
      const dto: ExitSettlementDto = { exitDeductionAmount: 2000 };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(insts) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 1000, remaining: 4000 });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.exitSettle(loanId, dto, 'actor', 'Actor');

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        loanId,
        expect.objectContaining({
          $set: expect.objectContaining({ status: LoanStatus.BadDebt, badDebtAmount: 4000 }),
        }),
        { new: true },
      );
    });
  });

  describe('deleteLoan', () => {
    const activeLoan = (overrides: Record<string, unknown> = {}) => {
      const loan: Record<string, unknown> = {
        _id: { toString: () => 'loan-1' },
        status: LoanStatus.Active,
        guarantorRestitutionOwed: 0,
        guarantorRestitutionPaid: 0,
        badDebtAmount: 0,
        principalAmount: 5000,
        totalRepayable: 5500,
        tenureMonths: 3,
        disbursedDate: new Date('2026-01-01'),
        staffId: 'staff-1',
        guarantorId: 'guarantor-1',
        ...overrides,
      };
      loan.toObject = () => ({ ...loan });
      return loan;
    };

    const pendingRepayment = (overrides: Record<string, unknown> = {}) => {
      const r: Record<string, unknown> = {
        instalmentNumber: 1,
        dueDate: new Date('2026-02-01'),
        dueAmount: 1000,
        paidAmount: 0,
        penaltyAmount: 0,
        status: LoanRepaymentStatus.Pending,
        payments: [],
        ...overrides,
      };
      r.toObject = () => ({ ...r });
      return r;
    };

    beforeEach(() => {
      repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      contributionsService.hasContributionsForLoan = jest.fn().mockResolvedValue(false);
      repaymentModel.deleteMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
      loanModel.findByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    });

    it('deletes an Active loan with zero financial trace and snapshots it into the audit log', async () => {
      const loan = activeLoan();
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.deleteLoan('loan-1', 'actor-1', 'Actor');

      expect(loanModel.findByIdAndDelete).toHaveBeenCalledWith('loan-1');
      const [, , , , , before] = auditService.log.mock.calls[0];
      expect(before).toEqual(expect.objectContaining({ loan: expect.objectContaining({ principalAmount: 5000 }) }));
    });

    it('captures full loan fields and repayment history, including a reversed payment, in the audit snapshot', async () => {
      const loan = activeLoan({ chequeNo: 'CHQ-1', pvNo: 'PV-1', interestRate: 8 });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      const repayment = pendingRepayment({
        penaltyAmount: 50,
        payments: [
          { amount: 200, type: PaymentEntryType.Payment },
          { amount: 200, type: PaymentEntryType.Reversal },
        ],
      });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([repayment]) });

      await service.deleteLoan('loan-1', 'actor-1', 'Actor');

      const [, , , , , before] = auditService.log.mock.calls[0];
      expect(before.loan).toEqual(expect.objectContaining({ chequeNo: 'CHQ-1', pvNo: 'PV-1', interestRate: 8 }));
      expect(before.repayments[0]).toEqual(expect.objectContaining({
        penaltyAmount: 50,
        payments: expect.arrayContaining([expect.objectContaining({ type: PaymentEntryType.Reversal })]),
      }));
    });

    it('cancels any active Origination discount for the loan', async () => {
      const loan = activeLoan();
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.deleteLoan('loan-1', 'actor-1', 'Actor');

      expect(discountModel.updateMany).toHaveBeenCalledWith(
        { loanId: 'loan-1', cancelled: false },
        expect.objectContaining({ cancelled: true, cancelledReason: expect.any(String) }),
      );
    });

    it('rejects a Completed loan regardless of financial state', async () => {
      const loan = activeLoan({ status: LoanStatus.Completed });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
      expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('rejects a Defaulted loan', async () => {
      const loan = activeLoan({ status: LoanStatus.Defaulted });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('rejects a WrittenOff loan', async () => {
      const loan = activeLoan({ status: LoanStatus.WrittenOff });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('rejects a BadDebt loan', async () => {
      const loan = activeLoan({ status: LoanStatus.BadDebt });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('rejects an Active loan with a paid instalment', async () => {
      const loan = activeLoan();
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(true) });

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
      expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('rejects an Active loan with outstanding guarantor restitution, even though it has no paid instalments', async () => {
      const loan = activeLoan({ guarantorRestitutionOwed: 500, guarantorRestitutionPaid: 100 });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
      expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('rejects an Active loan with recorded bad debt', async () => {
      const loan = activeLoan({ badDebtAmount: 200 });
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('rejects an Active loan with a linked Contribution row as a last-resort guard', async () => {
      const loan = activeLoan();
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
      contributionsService.hasContributionsForLoan = jest.fn().mockResolvedValue(true);

      await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
      expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
    });
  });

  describe('bulkDeleteLoans', () => {
    const activeLoan = (id: string) => {
      const loan: Record<string, unknown> = {
        _id: { toString: () => id },
        status: LoanStatus.Active,
        guarantorRestitutionOwed: 0,
        guarantorRestitutionPaid: 0,
        badDebtAmount: 0,
        principalAmount: 1000,
        totalRepayable: 1100,
        tenureMonths: 1,
        disbursedDate: new Date('2026-01-01'),
        staffId: 'staff-1',
        guarantorId: 'guarantor-1',
      };
      loan.toObject = () => ({ ...loan });
      return loan;
    };

    beforeEach(() => {
      contributionsService.hasContributionsForLoan = jest.fn().mockResolvedValue(false);
      repaymentModel.deleteMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
      loanModel.findByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    });

    it('deletes each deletable loan and reports their ids', async () => {
      const loan1 = activeLoan('l1');
      const loan2 = activeLoan('l2');
      loanModel.findById
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan1) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan2) });
      repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const result = await service.bulkDeleteLoans(['l1', 'l2'], 'actor-id', 'Actor');

      expect(result).toEqual({ deleted: ['l1', 'l2'], failed: [] });
      expect(loanModel.findByIdAndDelete).toHaveBeenCalledTimes(2);
    });

    it('reports a failure for one loan without blocking the ones before or after it in the batch', async () => {
      const loan1 = activeLoan('l1');
      const loan2 = { ...activeLoan('l2'), status: LoanStatus.Completed };
      const loan3 = activeLoan('l3');
      loanModel.findById
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan1) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan2) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan3) });
      repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const result = await service.bulkDeleteLoans(['l1', 'l2', 'l3'], 'actor-id', 'Actor');

      expect(result.deleted).toEqual(['l1', 'l3']);
      expect(result.failed).toEqual([
        { id: 'l2', reason: expect.stringContaining('Active loans can be deleted') },
      ]);
      expect(loanModel.findByIdAndDelete).toHaveBeenCalledTimes(2);
    });
  });
});
