/**
 * One-off remediation for 5 prod loans created with a backdated disbursedDate
 * instead of going through loans.legacy-import.service.ts. The daily overdue
 * cron treated a year of backdated instalments as live arrears and paid them
 * all off in one sweep, but the (now-fixed) cron-completion gap meant these
 * loans never flipped to Completed or settled guarantor restitution, and the
 * (now-fixed) source-mislabeling bug left 6 repayment rows tagged
 * GuarantorOffset when they were actually 100% DefaulterDeduction.
 *
 * This script is scoped to exactly the loan IDs / instalment numbers below —
 * it does not scan for "similar" cases. Re-verifies each record's current
 * state before writing (state may have changed since the bug report).
 *
 * Uses the real Nest schema definitions (not hand-rolled ones) so writes
 * are not silently stripped by Mongoose's default strict mode.
 *
 * Usage: npx ts-node -r tsconfig-paths/register apps/api/src/loans/migrations/remediate-backdated-loan-completions.ts
 * Default is a DRY RUN (no writes). Pass --confirm to actually write.
 */
import mongoose from 'mongoose';
import { RepaymentSource } from '@welfare/shared';
import { LoanSchema } from '../schemas/loan.schema';
import { LoanRepaymentSchema } from '../schemas/loan-repayment.schema';
import { ContributionSchema } from '../../contributions/schemas/contribution.schema';
import { AuditLogSchema } from '../../audit/audit-log.schema';

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare';
const CONFIRM = process.argv.includes('--confirm');

const LOAN_IDS = [
  '6ab2af16b8b481275230b68c',
  '6ab2af95b8b481275230b6de',
  '6ab2b26cb8b481275230b832',
  '6ab2b314b8b481275230b8cc',
  '6ab2b4acb8b481275230b9de',
];

const MISLABELED_ROWS: Array<{ loanId: string; instalmentNumber: number }> = [
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 8 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 9 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 10 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 11 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 12 },
  { loanId: '6ab2af16b8b481275230b68c', instalmentNumber: 12 },
];

type Models = {
  loanModel: any;
  repaymentModel: any;
  contributionModel: any;
  auditModel: any;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function remediateLoan(
  loanId: string,
  models: Models,
  confirm: boolean,
): Promise<{ loanId: string; action: 'settled' | 'would-settle' | 'skipped'; owed?: number; reason?: string }> {
  const loan = await models.loanModel.findById(loanId).exec();
  if (!loan) return { loanId, action: 'skipped', reason: 'loan not found' };
  if (loan.status !== 'Active') return { loanId, action: 'skipped', reason: `status is ${loan.status}, not Active` };

  const owed = round2((loan.guarantorRestitutionOwed ?? 0) - (loan.guarantorRestitutionPaid ?? 0));
  if (owed <= 0) return { loanId, action: 'skipped', reason: 'no outstanding restitution' };

  const unpaid = await models.repaymentModel.find({ loanId, status: { $ne: 'Paid' } }).exec();
  if (unpaid.length > 0) return { loanId, action: 'skipped', reason: `${unpaid.length} instalment(s) not Paid` };

  if (!confirm) return { loanId, action: 'would-settle', owed };

  // Status-guarded update first: if this loan's status changed since the read
  // above (lost a race, or a previous run already completed it), matchedCount
  // is 0 and we skip rather than crediting the guarantor a second time. A
  // re-run after a crash between this update and the contribution insert
  // below sees guarantorRestitutionPaid already incremented (owed <= 0 above)
  // and skips too — the credit insert is the one step that isn't re-run-safe,
  // so it always comes after the guard has already committed.
  const updateResult = await models.loanModel.updateOne(
    { _id: loanId, status: 'Active' },
    { $set: { status: 'Completed' }, $inc: { guarantorRestitutionPaid: owed } },
  );
  if (!updateResult || updateResult.matchedCount === 0) {
    return { loanId, action: 'skipped', reason: 'loan status changed before the update could apply' };
  }

  const now = new Date();
  await models.contributionModel.create({
    staffId: loan.guarantorId,
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    expectedAmount: 0,
    paidAmount: owed,
    surplusCarriedForward: 0,
    isDebit: false,
    status: 'Paid',
    source: 'DefaulterRestitution',
    loanId,
    recordedBy: 'remediation-script',
  });

  await models.auditModel.create({
    actorId: 'remediation-script',
    actorName: 'remediate-backdated-loan-completions',
    action: 'Update',
    entity: 'Loan',
    entityId: loanId,
    before: { status: 'Active', guarantorRestitutionPaid: loan.guarantorRestitutionPaid ?? 0 },
    after: { status: 'Completed', guarantorRestitutionPaid: (loan.guarantorRestitutionPaid ?? 0) + owed },
  });

  return { loanId, action: 'settled', owed };
}

export async function backfillRepaymentSource(
  loanId: string,
  instalmentNumber: number,
  models: Pick<Models, 'repaymentModel' | 'contributionModel'> & Partial<Pick<Models, 'auditModel'>>,
  confirm: boolean,
): Promise<{
  loanId: string;
  instalmentNumber: number;
  action: 'backfilled' | 'would-backfill' | 'skipped';
  reason?: string;
  source?: RepaymentSource;
  guarantorDebited?: number;
  borrowerDebited?: number;
}> {
  const row = await models.repaymentModel.findOne({ loanId, instalmentNumber }).exec();
  if (!row) return { loanId, instalmentNumber, action: 'skipped', reason: 'repayment row not found' };
  if (row.source !== 'GuarantorOffset') {
    return { loanId, instalmentNumber, action: 'skipped', reason: `row.source is ${row.source}, not GuarantorOffset — nothing to backfill` };
  }

  const debits = await models.contributionModel
    .find({ loanId, instalmentNumber, isDebit: true })
    .exec();

  if (debits.length === 0) {
    return { loanId, instalmentNumber, action: 'skipped', reason: 'no matching Contribution debit rows found for this instalment' };
  }

  const guarantorDebited = round2(
    debits.filter((d: any) => d.source === 'GuarantorOffset').reduce((sum: number, d: any) => sum + d.paidAmount, 0),
  );
  const borrowerDebited = round2(
    debits.filter((d: any) => d.source === 'DefaulterDeduction').reduce((sum: number, d: any) => sum + d.paidAmount, 0),
  );

  if (round2(guarantorDebited + borrowerDebited) !== round2(row.paidAmount ?? 0)) {
    return {
      loanId,
      instalmentNumber,
      action: 'skipped',
      reason: `mismatch: computed split ${guarantorDebited + borrowerDebited} does not equal row.paidAmount ${row.paidAmount}`,
    };
  }

  const source = guarantorDebited > 0 ? RepaymentSource.GuarantorOffset : RepaymentSource.DefaulterDeduction;

  if (!confirm) return { loanId, instalmentNumber, action: 'would-backfill', source, guarantorDebited, borrowerDebited };

  await models.repaymentModel.updateOne(
    { _id: row._id },
    { $set: { source, guarantorDebited, borrowerDebited } },
  );

  if (models.auditModel) {
    await models.auditModel.create({
      actorId: 'remediation-script',
      actorName: 'remediate-backdated-loan-completions',
      action: 'Update',
      entity: 'LoanRepayment',
      entityId: row._id.toString?.() ?? row._id,
      before: { source: row.source },
      after: { source, guarantorDebited, borrowerDebited },
    });
  }

  return { loanId, instalmentNumber, action: 'backfilled', source, guarantorDebited, borrowerDebited };
}

async function run(): Promise<void> {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB${CONFIRM ? '' : ' (DRY RUN — pass --confirm to write)'}`);

  const models: Models = {
    loanModel: mongoose.model('Loan', LoanSchema, 'loans'),
    repaymentModel: mongoose.model('LoanRepayment', LoanRepaymentSchema, 'loan_repayments'),
    contributionModel: mongoose.model('Contribution', ContributionSchema, 'contributions'),
    auditModel: mongoose.model('AuditLog', AuditLogSchema),
  };

  for (const loanId of LOAN_IDS) {
    try {
      const result = await remediateLoan(loanId, models, CONFIRM);
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Failed to remediate loan ${loanId}:`, err);
    }
  }

  for (const { loanId, instalmentNumber } of MISLABELED_ROWS) {
    try {
      const result = await backfillRepaymentSource(loanId, instalmentNumber, models, CONFIRM);
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Failed to backfill loan ${loanId} instalment ${instalmentNumber}:`, err);
    }
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
