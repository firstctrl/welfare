/**
 * Backfill principalAmount/interestAmount on loan_repayments rows that predate
 * those fields (e.g. seeded/demo loans inserted without a full instalment
 * breakdown). Recomputes them with the exact same amortization formula
 * LoansService.createLoan/createForImport use, so this is a deterministic
 * reconstruction from the loan's own principalAmount/interestRate/tenureMonths
 * — not an estimate.
 *
 * Usage: npx ts-node -r tsconfig-paths/register apps/api/src/loans/migrations/backfill-repayment-principal-interest-split.ts
 *
 * Idempotent: only touches rows where principalAmount does not yet exist.
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const LoanSchema = new mongoose.Schema({
  principalAmount: Number,
  totalRepayable: Number,
  tenureMonths: Number,
});

const LoanRepaymentSchema = new mongoose.Schema({
  loanId: String,
  instalmentNumber: Number,
  dueAmount: Number,
  principalAmount: Number,
  interestAmount: Number,
});

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const LoanModel = mongoose.model('Loan', LoanSchema, 'loans');
  const RepaymentModel = mongoose.model('LoanRepayment', LoanRepaymentSchema, 'loan_repayments');

  const affectedLoanIds: string[] = await RepaymentModel.distinct('loanId', {
    principalAmount: { $exists: false },
  });

  console.log(`Found ${affectedLoanIds.length} loan(s) with repayment rows missing principalAmount/interestAmount`);

  let updated = 0;
  let skippedLoans = 0;

  for (const loanId of affectedLoanIds) {
    const loan = await LoanModel.findById(loanId).lean();
    if (!loan || !loan.tenureMonths || loan.principalAmount == null || loan.totalRepayable == null) {
      console.warn(`Skipping loan ${loanId}: loan record missing or incomplete`);
      skippedLoans++;
      continue;
    }

    const totalInterest = round2(loan.totalRepayable - loan.principalAmount);
    const baseInterestPerInst = round2(totalInterest / loan.tenureMonths);

    const rows = await RepaymentModel.find({ loanId, principalAmount: { $exists: false } });
    for (const row of rows) {
      const isLast = row.instalmentNumber === loan.tenureMonths;
      const interestAmount = isLast
        ? round2(totalInterest - baseInterestPerInst * (loan.tenureMonths - 1))
        : baseInterestPerInst;
      const principalAmount = round2((row.dueAmount ?? 0) - interestAmount);

      await RepaymentModel.updateOne(
        { _id: row._id },
        { $set: { principalAmount, interestAmount } },
      );
      updated++;
    }
  }

  console.log(`Backfill complete: ${updated} repayment row(s) updated, ${skippedLoans} loan(s) skipped (incomplete loan record)`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
