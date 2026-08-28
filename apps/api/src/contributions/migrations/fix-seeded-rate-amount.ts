/**
 * One-off correction for the contribution_rates migration seed.
 *
 * The rate-history migration (ContributionRatesService.onModuleInit) seeds
 * its first entry from whatever MONTHLY_CONTRIBUTION_AMOUNT held at boot
 * time. If that config value had already been changed away from the
 * historical rate before this migration ran, the seeded entry's amount is
 * wrong (its effective-from month/year is still correct — it's only the
 * amount that needs fixing).
 *
 * This script finds the earliest entry in contribution_rates (lowest
 * effectiveKey) and updates its amount to the value you pass in. It does
 * NOT touch month/year, and does not write anything unless you pass --yes.
 *
 * Usage (dry run — shows what would change, writes nothing):
 *   npx ts-node -r tsconfig-paths/register \
 *     apps/api/src/contributions/migrations/fix-seeded-rate-amount.ts 3000
 *
 * Usage (apply):
 *   npx ts-node -r tsconfig-paths/register \
 *     apps/api/src/contributions/migrations/fix-seeded-rate-amount.ts 3000 --yes
 */
import mongoose from 'mongoose';

// Matches apps/api/src/config/configuration.ts's own resolution exactly.
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/welfare';

async function run() {
  const rawAmount = process.argv[2];
  const apply = process.argv.includes('--yes');

  const amount = parseFloat(rawAmount);
  if (!rawAmount || isNaN(amount) || amount <= 0) {
    console.error('Usage: fix-seeded-rate-amount.ts <correct-amount> [--yes]');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const rates = db.collection('contribution_rates');

  const earliest = await rates.find().sort({ effectiveKey: 1 }).limit(1).toArray();
  if (earliest.length === 0) {
    console.log('No contribution_rates entries found — nothing to fix.');
    await mongoose.disconnect();
    return;
  }

  const entry = earliest[0];
  console.log(`Earliest rate entry: ${entry.month}/${entry.year}, amount=${entry.amount} (_id=${entry._id})`);

  if (entry.amount === amount) {
    console.log('Amount already matches — nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Will change amount: ${entry.amount} -> ${amount}`);

  if (!apply) {
    console.log('Dry run only — no changes written. Re-run with --yes to apply.');
    await mongoose.disconnect();
    return;
  }

  await rates.updateOne({ _id: entry._id }, { $set: { amount } });
  console.log('Updated.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
