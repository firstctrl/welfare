import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { LoansService } from './loans.service';
import { Loan } from './schemas/loan.schema';
import { LoanRepayment } from './schemas/loan-repayment.schema';
import { Discount } from './schemas/discount.schema';
import { StaffService } from '../staff/staff.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionsService } from '../contributions/contributions.service';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';
import { LoanRepaymentStatus } from '@welfare/shared';

const mockLoanModel = { findById: jest.fn(), find: jest.fn(), create: jest.fn(), updateOne: jest.fn() };
const mockRepaymentModel = { find: jest.fn(), updateMany: jest.fn(), create: jest.fn(), insertMany: jest.fn() };
const mockDiscountModel = { create: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() };
const mockConfig = { getAll: jest.fn().mockResolvedValue({ LOAN_PAYOFF_DISCOUNT_RATE: { value: '5' } }) };
const noop = { log: jest.fn() };
const minioMock = { presignedGetObject: jest.fn(), putObject: jest.fn() };
const meiliMock = { index: jest.fn().mockReturnValue({ updateSettings: jest.fn().mockResolvedValue({}), addDocuments: jest.fn() }) };

function buildService(overrides: any = {}) {
  return Test.createTestingModule({
    providers: [
      LoansService,
      { provide: getModelToken(Loan.name), useValue: { ...mockLoanModel, ...overrides.loan } },
      { provide: getModelToken(LoanRepayment.name), useValue: { ...mockRepaymentModel, ...overrides.repayment } },
      { provide: getModelToken(Discount.name), useValue: { ...mockDiscountModel, ...overrides.discount } },
      { provide: 'StaffModel', useValue: {} },
      { provide: StaffService, useValue: { findById: jest.fn() } },
      { provide: SystemConfigService, useValue: mockConfig },
      { provide: AuditService, useValue: noop },
      { provide: ContributionsService, useValue: {} },
      { provide: 'MINIO_CLIENT', useValue: minioMock },
      { provide: LoanScheduleSenderService, useValue: { sendForLoan: jest.fn() } },
      { provide: 'MEILISEARCH_CLIENT', useValue: meiliMock },
    ],
  }).compile();
}

describe('LoansService.getPayOffPreview', () => {
  it('throws NotFoundException for unknown loan', async () => {
    const module = await buildService();
    const svc = module.get<LoansService>(LoansService);
    mockLoanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(svc.getPayOffPreview('unknown')).rejects.toThrow(NotFoundException);
  });

  it('Tier 1 loan: no discount applied', async () => {
    const module = await buildService();
    const svc = module.get<LoansService>(LoansService);

    mockLoanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'l1', principalAmount: 10000, totalRepayable: 11000, tenureMonths: 6,
        disbursedDate: new Date('2024-01-01'), interestRate: 10,
      }),
    });
    mockRepaymentModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { status: LoanRepaymentStatus.Paid, paidAmount: 1833.33, principalAmount: 1666.67, interestAmount: 166.66 },
        { status: LoanRepaymentStatus.Paid, paidAmount: 1833.33, principalAmount: 1666.67, interestAmount: 166.66 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.33 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.33 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.33 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.34 },
      ]),
    });

    const preview = await svc.getPayOffPreview('l1');
    expect(preview.tier).toBe(1);
    expect(preview.discountApplied).toBe(false);
    expect(preview.discountAmount).toBe(0);
  });

  it('Tier 2 within 6 months: discount applied', async () => {
    const module = await buildService();
    const svc = module.get<LoansService>(LoansService);

    const disbursed = new Date();
    disbursed.setMonth(disbursed.getMonth() - 2);

    mockLoanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'l2', principalAmount: 10000, totalRepayable: 11500, tenureMonths: 12,
        disbursedDate: disbursed, interestRate: 15,
      }),
    });
    mockRepaymentModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { status: LoanRepaymentStatus.Paid, paidAmount: 958.33, principalAmount: 833.33, interestAmount: 125 },
        { status: LoanRepaymentStatus.Paid, paidAmount: 958.33, principalAmount: 833.33, interestAmount: 125 },
        ...Array.from({ length: 10 }, () => ({
          status: LoanRepaymentStatus.Pending, paidAmount: 0,
          principalAmount: 833.33, interestAmount: 125, dueAmount: 958.33,
        })),
      ]),
    });

    const preview = await svc.getPayOffPreview('l2');
    expect(preview.tier).toBe(2);
    expect(preview.discountApplied).toBe(true);
    expect(preview.discountRate).toBe(5);
    expect(preview.discountAmount).toBeGreaterThan(0);
    expect(preview.netPayable).toBeLessThan(preview.remainingPrincipal + preview.remainingInterest);
  });
});
