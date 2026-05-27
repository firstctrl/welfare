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
import { LoanStatus, LoanRepaymentStatus, StaffStatus } from '@welfare/shared';
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

  beforeEach(async () => {
    loanModel = {
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
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
    };
    staffService = { findById: jest.fn().mockResolvedValue(activeStaff('staff-123')) };
    configService = { getAll: jest.fn() };
    auditService = { log: jest.fn() };
    contributionsService = {
      debitGuarantorOffset: jest.fn(),
      debitDefaulterContribution: jest.fn().mockResolvedValue({ debited: 0, remaining: 0 }),
      settleGuarantorRestitution: jest.fn().mockResolvedValue(0),
    };
    minioClient = { putObject: jest.fn(), presignedGetObject: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: getModelToken(Discount.name), useValue: { create: jest.fn().mockResolvedValue({}), findOne: jest.fn(), updateOne: jest.fn() } },
        { provide: StaffService, useValue: staffService },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
        { provide: MINIO_CLIENT, useValue: minioClient },
        { provide: LoanScheduleSenderService, useValue: { sendForLoan: jest.fn().mockResolvedValue(undefined) } },
        { provide: MEILISEARCH_CLIENT, useValue: { index: jest.fn().mockReturnValue({ addDocuments: jest.fn().mockResolvedValue(undefined), updateSettings: jest.fn().mockResolvedValue(undefined) }) } },
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
});
