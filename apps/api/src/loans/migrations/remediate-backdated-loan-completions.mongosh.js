// mongosh port of remediate-backdated-loan-completions.ts, for hosts without node/npx.
//
// One-off remediation for 5 prod loans created with a backdated disbursedDate
// instead of going through loans.legacy-import.service.ts. The daily overdue
// cron treated a year of backdated instalments as live arrears and paid them
// all off in one sweep, but the (now-fixed) cron-completion gap meant these
// loans never flipped to Completed or settled guarantor restitution, and the
// (now-fixed) source-mislabeling bug left 6 repayment rows tagged
// GuarantorOffset when they were actually 100% DefaulterDeduction.
//
// Scoped to exactly the loan IDs / instalment numbers below — does not scan
// for "similar" cases. Re-verifies each record's current state before
// writing (state may have changed since the bug report).
//
// Usage:
//   docker cp apps/api/src/loans/migrations/remediate-backdated-loan-completions.mongosh.js welfare-mongodb:/tmp/
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     /tmp/remediate-backdated-loan-completions.mongosh.js
//
// Default is a DRY RUN (no writes). Pass --eval "var CONFIRM=true" to write:
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     --eval "var CONFIRM=true" \
//     /tmp/remediate-backdated-loan-completions.mongosh.js
(function () {
  var confirm = typeof CONFIRM !== 'undefined' ? CONFIRM : false;

  var LOAN_IDS = [
    '6ab2af16b8b481275230b68c',
    '6ab2af95b8b481275230b6de',
    '6ab2b26cb8b481275230b832',
    '6ab2b314b8b481275230b8cc',
    '6ab2b4acb8b481275230b9de',
  ];

  var MISLABELED_ROWS = [
    { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 8 },
    { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 9 },
    { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 10 },
    { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 11 },
    { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 12 },
    { loanId: '6ab2af16b8b481275230b68c', instalmentNumber: 12 },
  ];

  var loans = db.getCollection('loans');
  var repayments = db.getCollection('loan_repayments');
  var contributions = db.getCollection('contributions');
  var auditLogs = db.getCollection('auditlogs');

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function remediateLoan(loanId) {
    var loan = loans.findOne({ _id: ObjectId(loanId) });
    if (!loan) return { loanId: loanId, action: 'skipped', reason: 'loan not found' };
    if (loan.status !== 'Active') return { loanId: loanId, action: 'skipped', reason: 'status is ' + loan.status + ', not Active' };

    var owed = round2((loan.guarantorRestitutionOwed || 0) - (loan.guarantorRestitutionPaid || 0));
    if (owed <= 0) return { loanId: loanId, action: 'skipped', reason: 'no outstanding restitution' };

    var unpaidCount = repayments.countDocuments({ loanId: loanId, status: { $ne: 'Paid' } });
    if (unpaidCount > 0) return { loanId: loanId, action: 'skipped', reason: unpaidCount + ' instalment(s) not Paid' };

    if (!confirm) return { loanId: loanId, action: 'would-settle', owed: owed };

    // Status-guarded update first: if the loan's status changed since the read
    // above, matchedCount is 0 and we skip rather than crediting the guarantor
    // a second time. A re-run after a crash between this update and the
    // contribution insert below sees guarantorRestitutionPaid already
    // incremented (owed <= 0 above) and skips too.
    var updateResult = loans.updateOne(
      { _id: ObjectId(loanId), status: 'Active' },
      { $set: { status: 'Completed' }, $inc: { guarantorRestitutionPaid: owed } },
    );
    if (!updateResult || updateResult.matchedCount === 0) {
      return { loanId: loanId, action: 'skipped', reason: 'loan status changed before the update could apply' };
    }

    var now = new Date();
    contributions.insertOne({
      staffId: loan.guarantorId,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      expectedAmount: 0,
      paidAmount: owed,
      surplusCarriedForward: 0,
      isDebit: false,
      status: 'Paid',
      source: 'DefaulterRestitution',
      loanId: loanId,
      recordedBy: 'remediation-script',
      createdAt: now,
    });

    auditLogs.insertOne({
      actorId: 'remediation-script',
      actorName: 'remediate-backdated-loan-completions',
      action: 'Update',
      entity: 'Loan',
      entityId: loanId,
      before: { status: 'Active', guarantorRestitutionPaid: loan.guarantorRestitutionPaid || 0 },
      after: { status: 'Completed', guarantorRestitutionPaid: (loan.guarantorRestitutionPaid || 0) + owed },
      createdAt: now,
    });

    return { loanId: loanId, action: 'settled', owed: owed };
  }

  function backfillRepaymentSource(loanId, instalmentNumber) {
    var row = repayments.findOne({ loanId: loanId, instalmentNumber: instalmentNumber });
    if (!row) return { loanId: loanId, instalmentNumber: instalmentNumber, action: 'skipped', reason: 'repayment row not found' };
    if (row.source !== 'GuarantorOffset') {
      return {
        loanId: loanId,
        instalmentNumber: instalmentNumber,
        action: 'skipped',
        reason: 'row.source is ' + row.source + ', not GuarantorOffset — nothing to backfill',
      };
    }

    var debits = contributions.find({ loanId: loanId, instalmentNumber: instalmentNumber, isDebit: true }).toArray();
    if (debits.length === 0) {
      return { loanId: loanId, instalmentNumber: instalmentNumber, action: 'skipped', reason: 'no matching Contribution debit rows found for this instalment' };
    }

    var guarantorDebited = round2(
      debits.filter(function (d) { return d.source === 'GuarantorOffset'; }).reduce(function (sum, d) { return sum + d.paidAmount; }, 0),
    );
    var borrowerDebited = round2(
      debits.filter(function (d) { return d.source === 'DefaulterDeduction'; }).reduce(function (sum, d) { return sum + d.paidAmount; }, 0),
    );

    if (round2(guarantorDebited + borrowerDebited) !== round2(row.paidAmount || 0)) {
      return {
        loanId: loanId,
        instalmentNumber: instalmentNumber,
        action: 'skipped',
        reason: 'mismatch: computed split ' + (guarantorDebited + borrowerDebited) + ' does not equal row.paidAmount ' + row.paidAmount,
      };
    }

    var source = guarantorDebited > 0 ? 'GuarantorOffset' : 'DefaulterDeduction';

    if (!confirm) {
      return { loanId: loanId, instalmentNumber: instalmentNumber, action: 'would-backfill', source: source, guarantorDebited: guarantorDebited, borrowerDebited: borrowerDebited };
    }

    repayments.updateOne({ _id: row._id }, { $set: { source: source, guarantorDebited: guarantorDebited, borrowerDebited: borrowerDebited } });

    auditLogs.insertOne({
      actorId: 'remediation-script',
      actorName: 'remediate-backdated-loan-completions',
      action: 'Update',
      entity: 'LoanRepayment',
      entityId: String(row._id),
      before: { source: row.source },
      after: { source: source, guarantorDebited: guarantorDebited, borrowerDebited: borrowerDebited },
      createdAt: new Date(),
    });

    return { loanId: loanId, instalmentNumber: instalmentNumber, action: 'backfilled', source: source, guarantorDebited: guarantorDebited, borrowerDebited: borrowerDebited };
  }

  print((confirm ? '' : '[DRY RUN — pass --eval "var CONFIRM=true" to write] ') + 'Remediating ' + LOAN_IDS.length + ' loan(s)');

  LOAN_IDS.forEach(function (loanId) {
    try {
      print(JSON.stringify(remediateLoan(loanId)));
    } catch (err) {
      print('ERROR remediating loan ' + loanId + ': ' + err);
    }
  });

  print('Backfilling ' + MISLABELED_ROWS.length + ' mislabeled repayment row(s)');

  MISLABELED_ROWS.forEach(function (row) {
    try {
      print(JSON.stringify(backfillRepaymentSource(row.loanId, row.instalmentNumber)));
    } catch (err) {
      print('ERROR backfilling loan ' + row.loanId + ' instalment ' + row.instalmentNumber + ': ' + err);
    }
  });
})();
