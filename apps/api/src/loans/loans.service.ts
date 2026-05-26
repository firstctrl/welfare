import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client as MinioClient } from 'minio';
import { MeiliSearch } from 'meilisearch';
import {
  AuditAction,
  AuditEntity,
  ConfigKey,
  IPayOffPreview,
  LoanRepaymentStatus,
  LoanStatus,
  PaginatedResult,
  RepaymentSource,
  StaffStatus,
} from '@welfare/shared';
import { Loan, LoanDocument } from './schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from './schemas/loan-repayment.schema';
import { Discount, DiscountDocument } from './schemas/discount.schema';
import { StaffService } from '../staff/staff.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionsService } from '../contributions/contributions.service';
import { MINIO_CLIENT } from '../storage/minio.module';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ExitSettlementDto } from './dto/exit-settlement.dto';
import { LoanQueryDto } from './dto/loan-query.dto';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';

type ConfigMap = Record<string, { value: string }>;

const LOAN_DOCS_BUCKET = 'loan-docs';
const LOAN_DOC_PRESIGN_TTL = 15 * 60;
const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_DOC_BYTES = 10 * 1024 * 1024;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  );
}

function computeDueDate(disbursedDate: Date, instalmentN: number): Date {
  const d = new Date(disbursedDate);
  d.setDate(1);
  d.setMonth(d.getMonth() + instalmentN);
  d.setDate(5);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class LoansService implements OnModuleInit {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name)
    private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly staffService: StaffService,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly loanScheduleSender: LoanScheduleSenderService,
    @Inject(MEILISEARCH_CLIENT) private readonly meiliClient: MeiliSearch,
    @InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
  ) {}

  async onModuleInit() {
    await this.meiliClient
      .index('loans')
      .updateSettings({
        searchableAttributes: ['staffName', 'staffId'],
        filterableAttributes: ['status'],
        sortableAttributes: ['disbursedDate', 'principalAmount'],
      })
      .catch(() => { /* non-fatal */ });
  }

  async reindexAll(): Promise<{ indexed: number }> {
    const allLoans = await this.loanModel.find().lean().exec();
    const staffIds = [...new Set(allLoans.map((l) => l.staffId))];
    const staffMap = new Map<string, string>();
    await Promise.all(
      staffIds.map(async (id) => {
        const s = await this.staffService.findByStaffId(id);
        if (s) staffMap.set(id, s.fullName);
      }),
    );
    const docs = allLoans.map((l) => ({
      id: (l._id as any).toString(),
      staffId: l.staffId,
      staffName: staffMap.get(l.staffId) ?? l.staffId,
      principalAmount: l.principalAmount,
      status: l.status,
      disbursedDate: l.disbursedDate,
    }));
    if (docs.length > 0) {
      await this.meiliClient.index('loans').addDocuments(docs, { primaryKey: 'id' });
    }
    return { indexed: docs.length };
  }

  private syncLoanToMeilisearch(loan: LoanDocument, staffName: string): void {
    const doc = {
      id: loan._id.toString(),
      staffId: loan.staffId,
      staffName,
      principalAmount: loan.principalAmount,
      status: loan.status,
      disbursedDate: loan.disbursedDate,
    };
    this.meiliClient
      .index('loans')
      .addDocuments([doc], { primaryKey: 'id' })
      .catch(() => { /* fire-and-forget */ });
  }

  // ───────────────── CREATE LOAN ─────────────────

  async create(dto: CreateLoanDto, actorId: string, actorName: string): Promise<LoanDocument> {
    const config = await this.configService.getAll();

    const staff = await this.staffService.findById(dto.staffId);
    if (staff.status !== StaffStatus.Active)
      throw new BadRequestException('Staff is not Active');

    const activeLoan = await this.loanModel
      .findOne({ staffId: dto.staffId, status: LoanStatus.Active })
      .exec();
    if (activeLoan) throw new ConflictException('Staff already has an active loan');

    const eligibilityMonths = parseInt(config[ConfigKey.EligibilityMonths]?.value ?? '6', 10);
    const employed = monthsBetween(new Date(staff.dateOfEmployment), new Date());
    if (employed < eligibilityMonths)
      throw new BadRequestException(
        `Staff must be employed for at least ${eligibilityMonths} months (currently ${employed})`,
      );

    if (dto.guarantorId === dto.staffId)
      throw new BadRequestException('Guarantor must be different from borrower');

    const guarantor = await this.staffService.findById(dto.guarantorId);
    if (guarantor.status !== StaffStatus.Active)
      throw new BadRequestException('Guarantor is not Active');

    const maxPerGuarantor = parseInt(config[ConfigKey.MaxLoansPerGuarantor]?.value ?? '0', 10);
    if (maxPerGuarantor > 0) {
      const guarantorLoanCount = await this.loanModel
        .countDocuments({ guarantorId: dto.guarantorId, status: LoanStatus.Active })
        .exec();
      if (guarantorLoanCount >= maxPerGuarantor)
        throw new BadRequestException(
          `Guarantor has reached the maximum of ${maxPerGuarantor} guaranteed active loans`,
        );
    }

    const minAmount = parseFloat(config[ConfigKey.LoanMinAmount]?.value ?? '500');
    const maxAmount = parseFloat(config[ConfigKey.LoanMaxAmount]?.value ?? '50000');
    if (dto.principalAmount < minAmount || dto.principalAmount > maxAmount)
      throw new BadRequestException(
        `Loan amount must be between ${minAmount} and ${maxAmount}`,
      );

    if (dto.tenureMonths < 1 || dto.tenureMonths > 12)
      throw new BadRequestException('Tenure must be between 1 and 12 months');

    const interestRate =
      dto.tenureMonths <= 6
        ? parseFloat(config[ConfigKey.InterestRateShort]?.value ?? '5')
        : parseFloat(config[ConfigKey.InterestRateLong]?.value ?? '8');

    const totalRepayable = round2(
      dto.principalAmount + dto.principalAmount * (interestRate / 100),
    );
    const monthlyInstalment = round2(totalRepayable / dto.tenureMonths);
    const disbursedDate = new Date(dto.disbursedDate);

    const loan = await this.loanModel.create({
      staffId: dto.staffId,
      guarantorId: dto.guarantorId,
      principalAmount: dto.principalAmount,
      interestRate,
      totalRepayable,
      monthlyInstalment,
      tenureMonths: dto.tenureMonths,
      disbursedDate,
      chequeNo: dto.chequeNo,
      pvNo: dto.pvNo,
      status: LoanStatus.Active,
      recordedBy: actorName,
    });

    this.syncLoanToMeilisearch(loan, staff.fullName);

    const loanId = loan._id.toString();
    const totalInterest = round2(totalRepayable - dto.principalAmount);
    const baseInterestPerInst = round2(totalInterest / dto.tenureMonths);
    const schedule = Array.from({ length: dto.tenureMonths }, (_, i) => {
      const isLast = i === dto.tenureMonths - 1;
      const dueAmount = isLast
        ? round2(totalRepayable - monthlyInstalment * (dto.tenureMonths - 1))
        : monthlyInstalment;
      const interestAmount = isLast
        ? round2(totalInterest - baseInterestPerInst * (dto.tenureMonths - 1))
        : baseInterestPerInst;
      const principalAmount = round2(dueAmount - interestAmount);
      return {
        loanId,
        staffId: dto.staffId,
        instalmentNumber: i + 1,
        dueDate: computeDueDate(disbursedDate, i + 1),
        dueAmount,
        principalAmount,
        interestAmount,
        paidAmount: 0,
        penaltyAmount: 0,
        status: LoanRepaymentStatus.Pending,
      };
    });
    await this.repaymentModel.insertMany(schedule);

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Disburse,
      AuditEntity.Loan,
      loanId,
      undefined,
      { principalAmount: dto.principalAmount, tenureMonths: dto.tenureMonths },
    );

    void this.loanScheduleSender.sendForLoan(loan).catch(err =>
      this.logger.warn(`Loan schedule email failed: ${(err as Error).message}`),
    );

    // Record origination discount for Tier 1 loans (tenureMonths ≤ 6, rate 10% vs 15%)
    if (dto.tenureMonths <= 6) {
      const discountAmount = round2(dto.principalAmount * 0.05);
      void this.discountModel.create({
        staffId: dto.staffId,
        loanId,
        discountType: 'Origination',
        discountRate: 5,
        discountAmount,
        dateGranted: disbursedDate,
      }).catch(err => this.logger.warn(`Failed to create origination discount: ${err.message}`));
    }

    return loan;
  }

  async createForImport(
    staffMongoId: string,
    guarantorMongoId: string,
    dto: { principalAmount: number; tenureMonths: number; disbursedDate: string; chequeNo: string; pvNo: string },
    actorId: string,
    actorName: string,
  ): Promise<LoanDocument> {
    const config = await this.configService.getAll();

    const interestRate =
      dto.tenureMonths <= 6
        ? parseFloat(config[ConfigKey.InterestRateShort]?.value ?? '5')
        : parseFloat(config[ConfigKey.InterestRateLong]?.value ?? '8');

    const totalRepayable = round2(dto.principalAmount + dto.principalAmount * (interestRate / 100));
    const monthlyInstalment = round2(totalRepayable / dto.tenureMonths);
    const disbursedDate = new Date(dto.disbursedDate);

    const loan = await this.loanModel.create({
      staffId: staffMongoId,
      guarantorId: guarantorMongoId,
      principalAmount: dto.principalAmount,
      interestRate,
      totalRepayable,
      monthlyInstalment,
      tenureMonths: dto.tenureMonths,
      disbursedDate,
      chequeNo: dto.chequeNo,
      pvNo: dto.pvNo,
      status: LoanStatus.Active,
      recordedBy: actorName,
    });

    const loanId = loan._id.toString();
    const totalInterest = round2(totalRepayable - dto.principalAmount);
    const baseInterestPerInst = round2(totalInterest / dto.tenureMonths);
    const schedule = Array.from({ length: dto.tenureMonths }, (_, i) => {
      const isLast = i === dto.tenureMonths - 1;
      const dueAmount = isLast
        ? round2(totalRepayable - monthlyInstalment * (dto.tenureMonths - 1))
        : monthlyInstalment;
      const interestAmount = isLast
        ? round2(totalInterest - baseInterestPerInst * (dto.tenureMonths - 1))
        : baseInterestPerInst;
      return {
        loanId,
        staffId: staffMongoId,
        instalmentNumber: i + 1,
        dueDate: computeDueDate(disbursedDate, i + 1),
        dueAmount,
        principalAmount: round2(dueAmount - interestAmount),
        interestAmount,
        paidAmount: 0,
        penaltyAmount: 0,
        status: LoanRepaymentStatus.Pending,
      };
    });
    await this.repaymentModel.insertMany(schedule);

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Loan,
      loanId,
      undefined,
      { principalAmount: dto.principalAmount, tenureMonths: dto.tenureMonths },
    );

    return loan;
  }

  // ───────────────── QUERIES ─────────────────

  async findAll(query: LoanQueryDto): Promise<PaginatedResult<LoanDocument>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = {};
    if (query.staffId) filter['staffId'] = query.staffId;
    if (query.status) filter['status'] = query.status;

    const [data, total] = await Promise.all([
      this.loanModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.loanModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string): Promise<LoanDocument> {
    const loan = await this.loanModel.findById(id).exec();
    if (!loan) throw new NotFoundException(`Loan ${id} not found`);
    return loan;
  }

  async findByStaff(staffId: string, page = 1, limit = 20): Promise<PaginatedResult<LoanDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.loanModel.find({ staffId }).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.loanModel.countDocuments({ staffId }).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByGuarantor(guarantorId: string, page = 1, limit = 20): Promise<PaginatedResult<LoanDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.loanModel.find({ guarantorId }).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.loanModel.countDocuments({ guarantorId }).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findBadDebt(page = 1, limit = 20): Promise<PaginatedResult<LoanDocument>> {
    const skip = (page - 1) * limit;
    const filter = { status: LoanStatus.BadDebt };
    const [data, total] = await Promise.all([
      this.loanModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).exec(),
      this.loanModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getRepaymentSchedule(loanId: string): Promise<LoanRepaymentDocument[]> {
    return this.repaymentModel.find({ loanId }).sort({ instalmentNumber: 1 }).exec();
  }

  // ───────────────── DOCUMENT ─────────────────

  async uploadDocument(
    loanId: string,
    file: Express.Multer.File,
    actorId: string,
    actorName: string,
  ): Promise<LoanDocument> {
    const loan = await this.findOne(loanId);

    if (!ALLOWED_DOC_TYPES.includes(file.mimetype))
      throw new BadRequestException('Document must be PDF, JPEG, or PNG');
    if (file.size > MAX_DOC_BYTES)
      throw new BadRequestException('Document must not exceed 10 MB');

    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? 'pdf';
    const key = `${loanId}/approval.${ext}`;
    await this.minioClient.putObject(LOAN_DOCS_BUCKET, key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });

    const updated = await this.loanModel
      .findByIdAndUpdate(loanId, { $set: { documentKey: key } }, { new: true })
      .exec();

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Update,
      AuditEntity.Loan,
      loanId,
      { documentKey: loan.documentKey },
      { documentKey: key },
    );

    return updated!;
  }

  async getDocumentUrl(loanId: string): Promise<{ url: string }> {
    const loan = await this.findOne(loanId);
    if (!loan.documentKey)
      throw new NotFoundException('No approval document uploaded for this loan');
    const url = await this.minioClient.presignedGetObject(
      LOAN_DOCS_BUCKET,
      loan.documentKey,
      LOAN_DOC_PRESIGN_TTL,
    );
    return { url };
  }

  // ───────────────── RECORD PAYMENT ─────────────────

  async recordPayment(
    loanId: string,
    dto: RecordPaymentDto,
    actorId: string,
    actorName: string,
  ): Promise<LoanRepaymentDocument[]> {
    return this.recordPaymentInternal(
      loanId,
      { amount: dto.amount, paidDate: dto.paidDate, notes: dto.notes },
      RepaymentSource.DirectPayment,
      actorId,
      actorName,
    );
  }

  async recordPaymentInternal(
    loanId: string,
    dto: { amount: number; paidDate: string; notes?: string },
    source: RepaymentSource,
    actorId: string,
    actorName: string,
  ): Promise<LoanRepaymentDocument[]> {
    const loan = await this.findOne(loanId);
    if (loan.status === LoanStatus.Completed)
      throw new BadRequestException('Loan is already completed');

    const config = await this.configService.getAll();
    const paidDate = new Date(dto.paidDate);
    if (paidDate > new Date())
      throw new BadRequestException('Payment date cannot be in the future');

    const pendingInstalments = await this.repaymentModel
      .find({
        loanId,
        status: {
          $in: [
            LoanRepaymentStatus.Pending,
            LoanRepaymentStatus.Partial,
            LoanRepaymentStatus.Overdue,
          ],
        },
      })
      .sort({ instalmentNumber: 1 })
      .exec();

    if (pendingInstalments.length === 0)
      throw new BadRequestException('No pending instalments for this loan');

    let remaining = dto.amount;
    const updated: LoanRepaymentDocument[] = [];

    for (const inst of pendingInstalments) {
      if (remaining <= 0) break;

      if (inst.status === LoanRepaymentStatus.Overdue && paidDate > inst.dueDate && inst.penaltyAmount === 0) {
        inst.penaltyAmount = this.calculatePenalty(inst.dueAmount, config as ConfigMap);
      }

      const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);

      if (remaining >= outstanding) {
        inst.paidAmount = round2(inst.paidAmount + outstanding);
        inst.status = LoanRepaymentStatus.Paid;
        remaining = round2(remaining - outstanding);
      } else {
        inst.paidAmount = round2(inst.paidAmount + remaining);
        inst.status = LoanRepaymentStatus.Partial;
        remaining = 0;
      }

      inst.paidDate = paidDate;
      inst.source = source;
      if (dto.notes) inst.notes = dto.notes;
      await inst.save();
      updated.push(inst);
    }

    await this.checkAndCompleteIfDone(loanId, actorId, actorName);

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.RecordPayment,
      AuditEntity.Loan,
      loanId,
      undefined,
      { amount: dto.amount, paidDate: dto.paidDate, source },
    );

    return updated;
  }

  private calculatePenalty(dueAmount: number, config: ConfigMap): number {
    const penaltyType = config[ConfigKey.PenaltyType]?.value ?? 'Fixed';
    const penaltyValue = parseFloat(config[ConfigKey.PenaltyValue]?.value ?? '0');
    if (penaltyValue === 0) return 0;
    return penaltyType === 'Percentage'
      ? round2(dueAmount * (penaltyValue / 100))
      : penaltyValue;
  }

  private async checkAndCompleteIfDone(
    loanId: string,
    actorId: string,
    actorName: string,
  ): Promise<void> {
    const remaining = await this.repaymentModel
      .find({ loanId, status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } })
      .exec();

    if (remaining.length === 0) {
      const completedLoan = await this.loanModel
        .findOneAndUpdate({ _id: loanId, status: LoanStatus.Active }, { $set: { status: LoanStatus.Completed } }, { new: true })
        .exec();
      if (completedLoan) {
        this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, undefined, {
          status: LoanStatus.Completed,
        });
        this.staffService.findById(completedLoan.staffId)
          .then(staff => this.syncLoanToMeilisearch(completedLoan, staff.fullName))
          .catch(() => { /* non-fatal */ });
      }
    }
  }

  // ───────────────── DELETE LOAN ─────────────────

  async deleteLoan(loanId: string, actorId: string, actorName: string): Promise<void> {
    const loan = await this.findOne(loanId);
    if (loan.status === LoanStatus.Active) {
      const hasPaid = await this.repaymentModel
        .exists({ loanId, paidAmount: { $gt: 0 } })
        .exec();
      if (hasPaid) throw new BadRequestException('Cannot delete an active loan with recorded payments');
    }
    await this.repaymentModel.deleteMany({ loanId }).exec();
    await this.loanModel.findByIdAndDelete(loanId).exec();
    this.meiliClient.index('loans').deleteDocument(loanId).catch(() => { /* non-fatal */ });
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, undefined, { deleted: true });
  }

  async deleteRepayment(
    loanId: string,
    repaymentId: string,
    actorId: string,
    actorName: string,
  ): Promise<void> {
    const repayment = await this.repaymentModel.findById(repaymentId).exec();
    if (!repayment || repayment.loanId !== loanId)
      throw new NotFoundException('Repayment not found');

    if (repayment.paidAmount === 0)
      throw new BadRequestException('No payment recorded on this instalment');

    if (
      repayment.source === RepaymentSource.ExitDeduction ||
      repayment.source === RepaymentSource.GuarantorOffset
    ) {
      throw new BadRequestException(
        `Cannot reverse a ${repayment.source} payment — reverse the originating settlement instead`,
      );
    }

    const before = { paidAmount: repayment.paidAmount, status: repayment.status, paidDate: repayment.paidDate };

    const now = new Date();
    repayment.paidAmount = 0;
    repayment.status = repayment.dueDate < now ? LoanRepaymentStatus.Overdue : LoanRepaymentStatus.Pending;
    repayment.paidDate = undefined;
    repayment.source = undefined;
    repayment.guarantorStaffId = undefined;
    repayment.notes = undefined;
    await repayment.save();

    // If loan was auto-completed, revert it to Active
    const loan = await this.findOne(loanId);
    if (loan.status === LoanStatus.Completed) {
      await this.loanModel.findByIdAndUpdate(loanId, { $set: { status: LoanStatus.Active } }).exec();
    }

    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.Loan, loanId, before, {
      repaymentId,
      action: 'repayment_reversed',
    });
  }

  // ───────────────── WRITE OFF ─────────────────

  async writeOff(loanId: string, actorId: string, actorName: string): Promise<LoanDocument> {
    const loan = await this.findOne(loanId);
    if (loan.status !== LoanStatus.Active)
      throw new BadRequestException('Only active loans can be written off');

    const unpaid = await this.repaymentModel
      .find({ loanId, status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } })
      .exec();

    const writtenOffAmount = round2(
      unpaid.reduce((s, r) => s + r.dueAmount + r.penaltyAmount - r.paidAmount, 0),
    );

    for (const inst of unpaid) {
      inst.status = LoanRepaymentStatus.Waived;
      await inst.save();
    }

    const updated = await this.loanModel
      .findByIdAndUpdate(
        loanId,
        { $set: { status: LoanStatus.WrittenOff, settledAt: new Date(), badDebtAmount: writtenOffAmount } },
        { new: true },
      )
      .exec();

    this.auditService.log(actorId, actorName, AuditAction.WriteOff, AuditEntity.Loan, loanId, undefined, {
      writtenOffAmount,
    });

    return updated!;
  }

  // ───────────────── EXIT SETTLEMENT ─────────────────

  async exitSettle(
    loanId: string,
    dto: ExitSettlementDto,
    actorId: string,
    actorName: string,
  ): Promise<LoanDocument> {
    const loan = await this.findOne(loanId);
    if (loan.status !== LoanStatus.Active)
      throw new BadRequestException('Loan is not Active');

    const unpaidInstalments = await this.repaymentModel
      .find({ loanId, status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } })
      .exec();

    const outstanding = round2(
      unpaidInstalments.reduce((sum, i) => sum + i.dueAmount + i.penaltyAmount - i.paidAmount, 0),
    );
    let remaining = round2(Math.max(0, outstanding - dto.exitDeductionAmount));

    let guarantorOffsetAmount = 0;
    let badDebtAmount = 0;
    let finalStatus = LoanStatus.Completed;

    let budgetLeft = dto.exitDeductionAmount;
    for (const inst of unpaidInstalments) {
      if (budgetLeft <= 0) break;
      const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
      if (budgetLeft >= owed) {
        inst.paidAmount = round2(inst.paidAmount + owed);
        inst.status = LoanRepaymentStatus.Paid;
        inst.source = RepaymentSource.ExitDeduction;
        inst.paidDate = new Date();
        budgetLeft = round2(budgetLeft - owed);
      } else {
        inst.paidAmount = round2(inst.paidAmount + budgetLeft);
        inst.status = LoanRepaymentStatus.Partial;
        inst.source = RepaymentSource.ExitDeduction;
        inst.paidDate = new Date();
        budgetLeft = 0;
      }
      await inst.save();
    }

    if (remaining > 0) {
      const { debited, remaining: stillUnpaid } =
        await this.contributionsService.debitGuarantorOffset(
          loan.guarantorId,
          remaining,
          loanId,
          actorId,
          actorName,
        );
      guarantorOffsetAmount = debited;
      badDebtAmount = round2(stillUnpaid);
      finalStatus = badDebtAmount > 0 ? LoanStatus.BadDebt : LoanStatus.Completed;

      if (guarantorOffsetAmount > 0) {
        let offsetLeft = guarantorOffsetAmount;
        const stillUnpaidInsts = await this.repaymentModel
          .find({ loanId, status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } })
          .exec();
        for (const inst of stillUnpaidInsts) {
          if (offsetLeft <= 0) break;
          const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
          if (offsetLeft >= owed) {
            inst.paidAmount = round2(inst.paidAmount + owed);
            inst.status = LoanRepaymentStatus.Paid;
            inst.source = RepaymentSource.GuarantorOffset;
            inst.guarantorStaffId = loan.guarantorId;
            inst.paidDate = new Date();
            offsetLeft = round2(offsetLeft - owed);
          } else {
            inst.paidAmount = round2(inst.paidAmount + offsetLeft);
            inst.status = LoanRepaymentStatus.Partial;
            inst.source = RepaymentSource.GuarantorOffset;
            inst.guarantorStaffId = loan.guarantorId;
            inst.paidDate = new Date();
            offsetLeft = 0;
          }
          await inst.save();
        }
      }
    }

    const updated = await this.loanModel
      .findByIdAndUpdate(
        loanId,
        {
          $set: {
            status: finalStatus,
            exitDeductionAmount: dto.exitDeductionAmount,
            guarantorOffsetAmount,
            badDebtAmount,
            settledAt: new Date(),
            notes: dto.notes,
          },
        },
        { new: true },
      )
      .exec();

    this.auditService.log(actorId, actorName, AuditAction.Settle, AuditEntity.Loan, loanId, undefined, {
      exitDeductionAmount: dto.exitDeductionAmount,
      guarantorOffsetAmount,
      badDebtAmount,
      finalStatus,
    });

    if (updated) {
      this.staffService.findById(updated.staffId)
        .then(staff => this.syncLoanToMeilisearch(updated, staff.fullName))
        .catch(() => { /* non-fatal */ });
    }

    return updated!;
  }

  // ───────────────── PAY-OFF ─────────────────

  async getPayOffPreview(loanId: string): Promise<IPayOffPreview> {
    const loan = await this.loanModel.findById(loanId).exec();
    if (!loan) throw new NotFoundException('Loan not found');

    const repayments = await this.repaymentModel.find({ loanId }).exec();
    const config = await this.configService.getAll();
    const payOffDiscountRate = parseFloat(config[ConfigKey.LoanPayOffDiscountRate]?.value ?? '5');

    const alreadyPaid = round2(repayments.reduce((s, r) => s + r.paidAmount, 0));
    const remaining = repayments.filter(r =>
      [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue].includes(r.status),
    );

    const remainingPrincipal = round2(remaining.reduce((s, r) => s + ((r.principalAmount ?? 0) - (r.status === LoanRepaymentStatus.Partial ? r.paidAmount * ((r.principalAmount ?? 0) / r.dueAmount) : 0)), 0));
    const remainingInterest = round2(remaining.reduce((s, r) => s + (r.interestAmount ?? 0), 0));

    const tier: 1 | 2 = loan.tenureMonths <= 6 ? 1 : 2;
    const monthsElapsed = monthsBetween(loan.disbursedDate, new Date());
    const withinDiscountWindow = tier === 2 && monthsElapsed < 6;
    const discountApplied = withinDiscountWindow;

    const discountAmount = discountApplied ? round2(remainingInterest * payOffDiscountRate / 100) : 0;
    const netPayable = round2(remainingPrincipal + remainingInterest - discountAmount);

    return {
      principal: loan.principalAmount,
      totalInterest: round2(loan.totalRepayable - loan.principalAmount),
      alreadyPaid,
      remainingPrincipal,
      remainingInterest,
      discountApplied,
      discountRate: discountApplied ? payOffDiscountRate : 0,
      discountAmount,
      netPayable,
      tier,
      withinDiscountWindow,
    };
  }

  async processPayOff(
    loanId: string,
    dto: { amountReceived: number; paymentDate: string },
    actorId: string,
    actorName: string,
  ): Promise<LoanDocument> {
    const loan = await this.loanModel.findById(loanId).exec();
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.status !== LoanStatus.Active) throw new BadRequestException('Loan is not Active');

    const preview = await this.getPayOffPreview(loanId);
    const paidDate = new Date(dto.paymentDate);

    const remaining = await this.repaymentModel.find({
      loanId,
      status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
    }).exec();
    for (const r of remaining) {
      r.paidAmount = r.dueAmount;
      r.paidDate = paidDate;
      r.source = RepaymentSource.PayOff;
      r.status = LoanRepaymentStatus.Paid;
      await r.save();
    }

    await this.loanModel.updateOne(
      { _id: loanId },
      {
        status: LoanStatus.Completed,
        settledAt: paidDate,
        payOffDate: paidDate,
        payOffAmountReceived: dto.amountReceived,
      },
    );

    if (preview.discountApplied) {
      await this.discountModel.create({
        staffId: loan.staffId,
        loanId,
        discountType: 'PayOff',
        discountRate: preview.discountRate,
        discountAmount: preview.discountAmount,
        dateGranted: paidDate,
      });
    }

    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, undefined, {
      event: 'payoff',
      amountReceived: dto.amountReceived,
      netPayable: preview.netPayable,
      discountApplied: preview.discountApplied,
    });

    return (await this.loanModel.findById(loanId).exec())!;
  }
}
