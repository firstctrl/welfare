/**
 * Backfill origination Discount records for existing Tier 1 loans
 * that were created before the discount feature was introduced.
 *
 * Usage: npx ts-node -r tsconfig-paths/register apps/api/src/loans/migrations/backfill-origination-discounts.ts
 *
 * Idempotent: safe to run multiple times.
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare';

const LoanSchema = new mongoose.Schema({
  staffId: String,
  tenureMonths: Number,
  interestRate: Number,
  principalAmount: Number,
  disbursedDate: Date,
  status: String,
});

const DiscountSchema = new mongoose.Schema({
  staffId: String,
  loanId: String,
  discountType: String,
  discountRate: Number,
  discountAmount: Number,
  dateGranted: Date,
  cancelled: { type: Boolean, default: false },
});

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const LoanModel = mongoose.model('Loan', LoanSchema, 'loans');
  const DiscountModel = mongoose.model('Discount', DiscountSchema, 'discounts');

  const tier1Loans = await LoanModel.find({
    tenureMonths: { $lte: 6 },
    interestRate: { $lte: 10 },
  }).lean();

  console.log(`Found ${tier1Loans.length} Tier 1 loans to check`);

  let created = 0;
  let skipped = 0;

  for (const loan of tier1Loans) {
    const loanId = (loan._id as mongoose.Types.ObjectId).toString();
    const existing = await DiscountModel.findOne({ loanId, discountType: 'Origination' });

    if (existing) {
      skipped++;
      continue;
    }

    const discountAmount = Math.round((loan.principalAmount ?? 0) * 0.05 * 100) / 100;
    await DiscountModel.create({
      staffId: loan.staffId,
      loanId,
      discountType: 'Origination',
      discountRate: 5,
      discountAmount,
      dateGranted: loan.disbursedDate,
      cancelled: false,
    });
    created++;
  }

  console.log(`Backfill complete: ${created} created, ${skipped} skipped (already had record)`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
