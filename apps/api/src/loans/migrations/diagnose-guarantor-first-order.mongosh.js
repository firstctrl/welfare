// Read-only diagnostic sweep: find every guarantor-offset debit made by the
// "Overdue Detection Job" cron (per the `contributions` collection —
// source='GuarantorOffset', recordedBy='Overdue Detection Job' — the ground
// truth for what was actually debited, unlike `auditlogs`, which is written
// fire-and-forget by AuditService.log and used a different payload shape in
// some historical cron versions) and, per defaulter, check whether their own
// contribution balance was ever nonzero across those debits. If so, the
// guarantor was wrongly tapped ahead of a defaulter who had funds available
// under the pre-fix debit order (see overdue-detection.job.ts). This performs
// NO writes — it is a report to inform a policy decision on whether to
// remediate historical loans, not a remediation script itself.
//
// Grouped per defaulter, not per debit: under the old guarantor-first order,
// a single cron run could debit the guarantor for several overdue
// instalments of the same defaulter without ever touching the defaulter's
// balance in between (it was only ever consulted as a fallback). Reporting
// each debit's "balance at the time" independently and summing them would
// count the same pot of money once per instalment. Instead this reports one
// line per defaulter: every guarantor-offset debit attributed to them, the
// total guarantor amount involved, and a single flaggedAmount capped at the
// defaulter's contribution balance as of the most recent of those debits
// (the balance can only have gone down since the earliest one, so this is
// the conservative, non-double-counted harm estimate).
//
// Usage:
//   docker cp apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js welfare-mongodb:/tmp/
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     /tmp/diagnose-guarantor-first-order.mongosh.js
(function () {
  var contributions = db.getCollection('contributions');
  var repayments = db.getCollection('loan_repayments');
  var loans = db.getCollection('loans');

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // Ground-truth guarantor-offset debits made by this cron. `borrowerStaffId`
  // and `instalmentNumber` were added to this call later in the job's
  // history; older rows may lack them, so the defaulter is also resolved via
  // the loan as a fallback below.
  var guarantorDebitRows = contributions
    .find({ source: 'GuarantorOffset', recordedBy: 'Overdue Detection Job', isDebit: true })
    .toArray();

  print('Found ' + guarantorDebitRows.length + ' guarantor-offset debit(s) from Overdue Detection Job');

  // Group by defaulter staffId.
  var byDefaulter = {};

  guarantorDebitRows.forEach(function (row) {
    var defaulterStaffId = row.borrowerStaffId;
    var loan = null;
    if (row.loanId) {
      loan = loans.findOne({ _id: ObjectId(row.loanId) });
    }
    if (!defaulterStaffId && loan) {
      defaulterStaffId = loan.staffId;
    }
    if (!defaulterStaffId) {
      print('SKIP: guarantor debit ' + row._id + ' has no borrowerStaffId and its loan ' + row.loanId + ' was not found — cannot attribute to a defaulter');
      return;
    }

    var repayment = null;
    if (row.instalmentNumber != null && row.loanId) {
      repayment = repayments.findOne({ loanId: row.loanId, instalmentNumber: row.instalmentNumber });
    }

    if (!byDefaulter[defaulterStaffId]) {
      byDefaulter[defaulterStaffId] = {
        staffId: defaulterStaffId,
        guarantorId: row.staffId,
        debits: [],
      };
    }

    byDefaulter[defaulterStaffId].debits.push({
      contributionId: row._id,
      loanId: row.loanId,
      instalmentNumber: row.instalmentNumber != null ? row.instalmentNumber : (repayment ? repayment.instalmentNumber : undefined),
      guarantorDebited: row.paidAmount,
      debitTimestamp: row.createdAt,
    });
  });

  var candidates = [];

  Object.keys(byDefaulter).forEach(function (staffId) {
    var group = byDefaulter[staffId];
    group.debits.sort(function (a, b) { return a.debitTimestamp - b.debitTimestamp; });

    var latestDebitTimestamp = group.debits[group.debits.length - 1].debitTimestamp;

    // Defaulter's contribution balance as of the most recent guarantor debit
    // attributed to them: sum of all credit rows minus all debit rows for
    // the defaulter, dated up to (and including) that timestamp.
    var defaulterContribs = contributions
      .find({ staffId: staffId, createdAt: { $lte: latestDebitTimestamp } })
      .toArray();

    var balanceAsOfLatestDebit = round2(
      defaulterContribs.reduce(function (sum, c) {
        return sum + (c.isDebit ? -c.paidAmount : c.paidAmount);
      }, 0),
    );

    if (balanceAsOfLatestDebit <= 0) return;

    var totalGuarantorDebited = round2(
      group.debits.reduce(function (sum, d) { return sum + d.guarantorDebited; }, 0),
    );

    // Capped at the available balance — see file header for why this isn't
    // just the sum of each debit's own "balance at the time".
    var flaggedAmount = round2(Math.min(totalGuarantorDebited, balanceAsOfLatestDebit));

    candidates.push({
      staffId: staffId,
      guarantorId: group.guarantorId,
      debitCount: group.debits.length,
      totalGuarantorDebited: totalGuarantorDebited,
      balanceAsOfLatestDebit: balanceAsOfLatestDebit,
      flaggedAmount: flaggedAmount,
      debits: group.debits,
    });
  });

  print('Remediation candidates (defaulters with a guarantor-offset debit and an available balance): ' + candidates.length);
  candidates.forEach(function (c) {
    print(JSON.stringify(c));
  });
})();
