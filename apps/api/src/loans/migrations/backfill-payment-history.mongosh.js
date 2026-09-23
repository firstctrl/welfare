// mongosh port of backfill-payment-history.ts, for hosts without node/npx.
//
// Backfills a `payments` history entry on loan_repayments rows that predate
// per-payment tracking (paidAmount > 0 but no payments array yet). Synthesizes
// a single entry from the row's existing paidAmount/paidDate/source, attributed
// to the loan's recordedBy — best-effort reconstruction, not a real history:
// an earlier partial payment on the same instalment predating this migration
// is unrecoverable, which the backfilled note says explicitly.
//
// Usage:
//   docker cp apps/api/src/loans/migrations/backfill-payment-history.mongosh.js welfare-mongodb:/tmp/
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     /tmp/backfill-payment-history.mongosh.js
//
// Dry run (no writes, just logs what would change):
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     --eval "var DRY_RUN=true" \
//     /tmp/backfill-payment-history.mongosh.js
//
// Idempotent: only touches rows where paidAmount > 0 and payments is empty.
(function () {
  var dryRun = typeof DRY_RUN !== 'undefined' ? DRY_RUN : false;

  var repayments = db.getCollection('loan_repayments');
  var loans = db.getCollection('loans');

  var rows = repayments
    .find({
      paidAmount: { $gt: 0 },
      $or: [{ payments: { $exists: false } }, { payments: { $size: 0 } }],
    })
    .toArray();

  print((dryRun ? '[dry-run] ' : '') + 'Found ' + rows.length + ' repayment row(s) missing payment history');

  var updated = 0;
  var skipped = 0;

  rows.forEach(function (row) {
    var loan = loans.findOne({ _id: ObjectId(row.loanId) });
    if (!loan) {
      print('Skipping repayment ' + String(row._id) + ': loan ' + row.loanId + ' not found');
      skipped++;
      return;
    }

    var entry = {
      amount: row.paidAmount,
      paidDate: row.paidDate || row.createdAt || new Date(),
      recordedAt: new Date(),
      recordedById: 'migration',
      recordedByName: loan.recordedBy || 'Unknown',
      source: row.source || 'DirectPayment',
      notes: 'Backfilled — pre-dates payment history tracking, earlier partial payments (if any) are not recoverable',
      type: 'Payment',
    };

    if (dryRun) {
      print('[dry-run] would update repayment ' + String(row._id) + ' (loan ' + row.loanId + '): ' + JSON.stringify(entry));
    } else {
      repayments.updateOne({ _id: row._id }, { $set: { payments: [entry] } });
    }
    updated++;
  });

  print(
    (dryRun ? '[dry-run] ' : '') +
      'Backfill complete: ' +
      updated +
      ' repayment row(s) ' +
      (dryRun ? 'would be ' : '') +
      'updated, ' +
      skipped +
      ' skipped (loan not found)',
  );
})();
