/**
 * Backfill borrower-side defaulter-deduction rows for historical
 * loan_repayments that recorded a guarantor offset without the
 * corresponding borrower debit when the guarantor's balance was
 * insufficient to cover the full instalment.
 *
 * Also sets loan.guarantorRestitutionOwed for those loans so future
 * borrower contributions redirect to the guarantor.
 *
 * Match rule: for each loan_repayments row with source=GuarantorOffset,
 * compare its paidAmount to the sum of contribution debits already
 * attributed to (loanId, instalmentNumber). If paidAmount exceeds the
 * sum, create one DefaulterDeduction contribution debit on the borrower
 * (loan.staffId) for the gap.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register \
 *     apps/api/src/contributions/migrations/backfill-defaulter-shortfall.ts
 *
 * Idempotent: only creates a borrower debit when the gap > 0.01.
 */
import mongoose from 'mongoose';

const MONGO_USER = process.env.MONGO_USER;
const MONGO_PASSWORD = process.env.MONGO_PASSWORD;
const MONGO_URI = MONGO_USER && MONGO_PASSWORD
  ? `mongodb://${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PASSWORD)}@localhost:27017/welfare?authSource=admin`
  : (process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare');

const EPSILON = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const contribs = db.collection('contributions');
  const repays = db.collection('loan_repayments');
  const loans = db.collection('loans');

  const offsetRepays = await repays.find({ source: 'GuarantorOffset' }).toArray();
  console.log(`Scanning ${offsetRepays.length} loan_repayments with source=GuarantorOffset`);

  let created = 0;
  let alreadyOk = 0;
  let restitutionBumped = 0;
  let missingLoan = 0;

  for (const r of offsetRepays) {
    const loan = await loans.findOne({ _id: new mongoose.Types.ObjectId(r.loanId) });
    if (!loan) {
      missingLoan++;
      console.log(`  loan ${r.loanId} not found, skipped`);
      continue;
    }

    const attributedDebits = await contribs.find({
      isDebit: true,
      loanId: r.loanId,
      instalmentNumber: r.instalmentNumber,
    }).toArray();

    const debitedTotal = round2(attributedDebits.reduce((s, d) => s + (d.paidAmount ?? 0), 0));
    const repayPaid = round2(r.paidAmount ?? 0);
    const gap = round2(repayPaid - debitedTotal);

    if (gap <= EPSILON) {
      alreadyOk++;
      continue;
    }

    const now = new Date();
    await contribs.insertOne({
      staffId: loan.staffId,
      month: r.paidDate ? r.paidDate.getMonth() + 1 : now.getMonth() + 1,
      year: r.paidDate ? r.paidDate.getFullYear() : now.getFullYear(),
      expectedAmount: 0,
      paidAmount: gap,
      surplusCarriedForward: 0,
      isDebit: true,
      status: 'Paid',
      source: 'DefaulterDeduction',
      loanId: r.loanId,
      instalmentNumber: r.instalmentNumber,
      recordedBy: 'Backfill: Defaulter Shortfall',
      createdAt: r.paidDate ?? now,
      updatedAt: now,
    });
    created++;

    // Bump restitutionOwed by the guarantor portion (everything except the new borrower debit)
    const guarantorPortion = round2(repayPaid - gap);
    if (guarantorPortion > 0) {
      const currentOwed = loan.guarantorRestitutionOwed ?? 0;
      const currentPaid = loan.guarantorRestitutionPaid ?? 0;
      const owedDelta = round2(guarantorPortion - (currentOwed - currentPaid));
      if (owedDelta > EPSILON) {
        await loans.updateOne(
          { _id: loan._id },
          { $inc: { guarantorRestitutionOwed: owedDelta } },
        );
        restitutionBumped++;
        console.log(`  loan ${r.loanId} inst#${r.instalmentNumber}: created borrower debit ${gap}, bumped restitutionOwed by ${owedDelta}`);
      } else {
        console.log(`  loan ${r.loanId} inst#${r.instalmentNumber}: created borrower debit ${gap}, restitutionOwed already covers guarantor portion`);
      }
    }
  }

  console.log('---');
  console.log(`borrower debits created: ${created}`);
  console.log(`already balanced:        ${alreadyOk}`);
  console.log(`restitutionOwed bumped:  ${restitutionBumped}`);
  console.log(`missing loans:           ${missingLoan}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
