// One-off backfill for loans hit by the overdue-detection defaulter-only-tap
// bug: apps/api/src/loans/jobs/overdue-detection.job.ts debited a defaulter's
// own contributions (source=DefaulterDeduction on loan_repayments) without
// ever $inc'ing loan.defaulterContributionDebited, so the "Default Recovery"
// summary on affected loans showed 0 despite schedule rows tagged
// DefaulterDeduction. Fixed going forward in the same file; this backfills
// loan.defaulterContributionDebited for loans already affected.
//
// Source of truth: the `contributions` collection already has one debit row
// per deduction (source=DefaulterDeduction, isDebit=true, loanId set) —
// written by both the (buggy) overdue-detection job and the (correct)
// default-recovery job. Recomputes loan.defaulterContributionDebited as the
// sum of those rows per loanId and $sets it directly, so reruns are
// naturally idempotent (same input always yields the same $set value,
// regardless of how many times the script has already run).
//
// Usage:
//   docker cp apps/api/src/loans/migrations/backfill-defaulter-contribution-debited.mongosh.js welfare-mongodb:/tmp/
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     /tmp/backfill-defaulter-contribution-debited.mongosh.js
//
// Default is a DRY RUN (no writes). Pass --eval "var CONFIRM=true" to write:
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     --eval "var CONFIRM=true" \
//     /tmp/backfill-defaulter-contribution-debited.mongosh.js
(function () {
  var confirm = typeof CONFIRM !== 'undefined' ? CONFIRM : false;

  var loans = db.getCollection('loans');
  var contributions = db.getCollection('contributions');
  var auditLogs = db.getCollection('auditlogs');

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  var totalsByLoanId = {};
  contributions.find({ isDebit: true, source: 'DefaulterDeduction', loanId: { $exists: true, $ne: null } }).forEach(function (row) {
    var key = String(row.loanId);
    totalsByLoanId[key] = round2((totalsByLoanId[key] || 0) + (row.paidAmount || 0));
  });

  var loanIds = Object.keys(totalsByLoanId);
  print((confirm ? '' : '[DRY RUN — pass --eval "var CONFIRM=true" to write] ') + 'Checking ' + loanIds.length + ' loan(s) with DefaulterDeduction contribution debits');

  var updated = 0;
  var alreadyCorrect = 0;
  var missingLoan = 0;

  loanIds.forEach(function (loanId) {
    var loan = loans.findOne({ _id: ObjectId(loanId) });
    if (!loan) {
      missingLoan++;
      print('  loan ' + loanId + ' not found, skipped');
      return;
    }

    var correctTotal = totalsByLoanId[loanId];
    var currentTotal = round2(loan.defaulterContributionDebited || 0);

    if (currentTotal === correctTotal) {
      alreadyCorrect++;
      return;
    }

    print('  loan ' + loanId + ': defaulterContributionDebited ' + currentTotal + ' -> ' + correctTotal);

    if (!confirm) return;

    loans.updateOne({ _id: ObjectId(loanId) }, { $set: { defaulterContributionDebited: correctTotal } });

    auditLogs.insertOne({
      actorId: 'backfill-script',
      actorName: 'backfill-defaulter-contribution-debited',
      action: 'Update',
      entity: 'Loan',
      entityId: loanId,
      before: { defaulterContributionDebited: currentTotal },
      after: { defaulterContributionDebited: correctTotal },
      createdAt: new Date(),
    });

    updated++;
  });

  print('---');
  print('updated:         ' + updated);
  print('already correct: ' + alreadyCorrect);
  print('missing loans:   ' + missingLoan);
})();
