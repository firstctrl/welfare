/**
 * Plain-JS twin of fix-seeded-rate-amount.ts, for running inside the
 * production container where only compiled dist/ + prod deps exist (no
 * ts-node/typescript). Same behavior: dry-run by default, --yes to apply.
 *
 * Usage (from inside the container, e.g. via `docker exec`):
 *   node fix-seeded-rate-amount.js 3000
 *   node fix-seeded-rate-amount.js 3000 --yes
 */
const mongoose = require('mongoose');

const MONGO_USER = process.env.MONGO_USER;
const MONGO_PASSWORD = process.env.MONGO_PASSWORD;
const MONGO_URI = MONGO_USER && MONGO_PASSWORD
  ? `mongodb://${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PASSWORD)}@localhost:27017/welfare?authSource=admin`
  : (process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare');

async function run() {
  const rawAmount = process.argv[2];
  const apply = process.argv.includes('--yes');

  const amount = parseFloat(rawAmount);
  if (!rawAmount || isNaN(amount) || amount <= 0) {
    console.error('Usage: node fix-seeded-rate-amount.js <correct-amount> [--yes]');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
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
