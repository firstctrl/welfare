/**
 * Backfill a `payments` history entry on loan_repayments rows that predate
 * per-payment tracking (paidAmount > 0 but no payments array yet). Synthesizes
 * a single entry from the row's existing paidAmount/paidDate/source, attributed
 * to the loan's recordedBy — this is a best-effort reconstruction, not a real
 * history: any earlier partial payment on the same instalment before this
 * migration ran is unrecoverable, which the backfilled note says explicitly.
 *
 * Usage: npx ts-node -r tsconfig-paths/register apps/api/src/loans/migrations/backfill-payment-history.ts
 * Dry run (no writes, just logs what would change): add --dry-run
 *
 * Idempotent: only touches rows where paidAmount > 0 and payments is empty.
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare';
const DRY_RUN = process.argv.includes('--dry-run');

const LoanSchema = new mongoose.Schema({
  recordedBy: String,
});

const LoanRepaymentSchema = new mongoose.Schema({
  loanId: String,
  paidAmount: Number,
  paidDate: Date,
  source: String,
  payments: [mongoose.Schema.Types.Mixed],
});

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB${DRY_RUN ? ' (dry run — no writes will be made)' : ''}`);

  const LoanModel = mongoose.model('Loan', LoanSchema, 'loans');
  const RepaymentModel = mongoose.model('LoanRepayment', LoanRepaymentSchema, 'loan_repayments');

  const rows = await RepaymentModel.find({
    paidAmount: { $gt: 0 },
    $or: [{ payments: { $exists: false } }, { payments: { $size: 0 } }],
  });

  console.log(`Found ${rows.length} repayment row(s) missing payment history`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const loan = await LoanModel.findById(row.loanId).lean();
    if (!loan) {
      console.warn(`Skipping repayment ${row._id.toString()}: loan ${row.loanId} not found`);
      skipped++;
      continue;
    }

    const entry = {
      amount: row.paidAmount,
      paidDate: row.paidDate ?? row.get('createdAt') ?? new Date(),
      recordedAt: new Date(),
      recordedById: 'migration',
      recordedByName: loan.recordedBy ?? 'Unknown',
      source: row.source ?? 'DirectPayment',
      notes: 'Backfilled — pre-dates payment history tracking, earlier partial payments (if any) are not recoverable',
      type: 'Payment',
    };

    if (DRY_RUN) {
      console.log(`[dry-run] would update repayment ${row._id.toString()} (loan ${row.loanId}):`, entry);
    } else {
      await RepaymentModel.updateOne({ _id: row._id }, { $set: { payments: [entry] } });
    }
    updated++;
  }

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}Backfill complete: ${updated} repayment row(s) ${DRY_RUN ? 'would be' : ''} updated, ${skipped} skipped (loan not found)`,
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
