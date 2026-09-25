// Read-only diagnostic sweep: find every LoanRepayment GuarantorOffset debit
// made by the "Overdue Detection Job" cron (per auditlogs, entity=LoanRepayment,
// actorName='Overdue Detection Job') and check whether the defaulter's own
// contribution balance was nonzero at that debit's timestamp. If so, the
// guarantor was wrongly tapped ahead of a defaulter who had funds available
// under the pre-fix debit order (see overdue-detection.job.ts). This performs
// NO writes — it is a report to inform a policy decision on whether to
// remediate historical loans, not a remediation script itself.
//
// Usage:
//   docker cp apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js welfare-mongodb:/tmp/
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     /tmp/diagnose-guarantor-first-order.mongosh.js
(function () {
  var auditLogs = db.getCollection('auditlogs');
  var contributions = db.getCollection('contributions');
  var repayments = db.getCollection('loan_repayments');
  var loans = db.getCollection('loans');

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // Every audit entry the cron wrote for a repayment it touched with a
  // nonzero guarantorDebited.
  var auditEntries = auditLogs
    .find({
      entity: 'LoanRepayment',
      actorName: 'Overdue Detection Job',
      'after.guarantorDebited': { $gt: 0 },
    })
    .toArray();

  print('Found ' + auditEntries.length + ' guarantor-offset audit entries from Overdue Detection Job');

  var candidates = [];

  auditEntries.forEach(function (entry) {
    var repaymentId = entry.entityId;
    var repayment = repayments.findOne({ _id: ObjectId(repaymentId) });
    if (!repayment) {
      print('SKIP: repayment ' + repaymentId + ' not found (may have been reversed)');
      return;
    }

    var loan = loans.findOne({ _id: ObjectId(repayment.loanId) });
    if (!loan) {
      print('SKIP: loan ' + repayment.loanId + ' not found for repayment ' + repaymentId);
      return;
    }

    var debitTimestamp = entry.createdAt;

    // Defaulter's contribution balance at the moment of this debit: sum of
    // all non-debit (credit) contribution rows minus all debit rows for the
    // defaulter, dated up to (and including) the debit timestamp.
    var defaulterContribs = contributions
      .find({ staffId: loan.staffId, createdAt: { $lte: debitTimestamp } })
      .toArray();

    var balanceAtDebitTime = round2(
      defaulterContribs.reduce(function (sum, c) {
        return sum + (c.isDebit ? -c.paidAmount : c.paidAmount);
      }, 0),
    );

    if (balanceAtDebitTime > 0) {
      candidates.push({
        loanId: repayment.loanId,
        repaymentId: repaymentId,
        instalmentNumber: repayment.instalmentNumber,
        guarantorDebited: entry.after.guarantorDebited,
        borrowerDebited: entry.after.borrowerDebited,
        defaulterBalanceAtDebitTime: balanceAtDebitTime,
        debitTimestamp: debitTimestamp,
        staffId: loan.staffId,
        guarantorId: loan.guarantorId,
      });
    }
  });

  print('Remediation candidates (guarantor debited while defaulter had a nonzero balance): ' + candidates.length);
  candidates.forEach(function (c) {
    print(JSON.stringify(c));
  });
})();
