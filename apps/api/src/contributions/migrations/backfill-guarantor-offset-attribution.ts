/**
 * Backfill loanId, borrowerStaffId, instalmentNumber on existing
 * Contribution debit rows (source=GuarantorOffset) by matching against
 * loan_repayment rows that recorded the same offset event.
 *
 * Match rule: contributions.isDebit=true + source='GuarantorOffset' linked
 * to a loan_repayments row where guarantorStaffId == contribution.staffId
 * AND source='GuarantorOffset' AND paidDate within ±2 minutes of
 * contribution.createdAt. Picks the closest match.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register \
 *     apps/api/src/contributions/migrations/backfill-guarantor-offset-attribution.ts
 *
 * Idempotent: only updates rows missing loanId.
 */
import mongoose from 'mongoose';

const MONGO_USER = process.env.MONGO_USER;
const MONGO_PASSWORD = process.env.MONGO_PASSWORD;
const MONGO_URI = MONGO_USER && MONGO_PASSWORD
  ? `mongodb://${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PASSWORD)}@localhost:27017/welfare?authSource=admin`
  : (process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare');

const MATCH_WINDOW_MS = 2 * 60 * 1000;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const contribs = db.collection('contributions');
  const repays = db.collection('loan_repayments');
  const loans = db.collection('loans');

  const candidates = await contribs.find({
    isDebit: true,
    source: 'GuarantorOffset',
    $or: [{ loanId: { $exists: false } }, { loanId: null }],
  }).toArray();

  console.log(`Found ${candidates.length} debit rows missing attribution`);

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const c of candidates) {
    const guarantorId: string = c.staffId;
    const at: Date = c.createdAt ?? c.updatedAt;
    if (!at) {
      unmatched++;
      console.log(`  ${c._id}: no timestamp, skipped`);
      continue;
    }

    const lo = new Date(at.getTime() - MATCH_WINDOW_MS);
    const hi = new Date(at.getTime() + MATCH_WINDOW_MS);

    const hits = await repays.find({
      guarantorStaffId: guarantorId,
      source: 'GuarantorOffset',
      paidDate: { $gte: lo, $lte: hi },
    }).toArray();

    if (hits.length === 0) {
      unmatched++;
      console.log(`  ${c._id}: no loan_repayment match within ${MATCH_WINDOW_MS / 1000}s of ${at.toISOString()}`);
      continue;
    }

    let pick = hits[0];
    if (hits.length > 1) {
      pick = hits.reduce((best, h) =>
        Math.abs(h.paidDate.getTime() - at.getTime()) < Math.abs(best.paidDate.getTime() - at.getTime()) ? h : best,
      );
      ambiguous++;
      console.log(`  ${c._id}: ${hits.length} candidate repayments; picked closest (loanId=${pick.loanId} inst#${pick.instalmentNumber})`);
    }

    const loan = await loans.findOne({ _id: new mongoose.Types.ObjectId(pick.loanId) });
    const borrowerStaffId = loan?.staffId;

    await contribs.updateOne(
      { _id: c._id },
      {
        $set: {
          loanId: pick.loanId,
          instalmentNumber: pick.instalmentNumber,
          ...(borrowerStaffId ? { borrowerStaffId } : {}),
        },
      },
    );
    matched++;
  }

  console.log('---');
  console.log(`matched:   ${matched}`);
  console.log(`ambiguous: ${ambiguous} (closest-paidDate heuristic used)`);
  console.log(`unmatched: ${unmatched}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
