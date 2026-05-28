import { LoanRepaymentStatus } from '@welfare/shared';

interface LoanStatementEmailInstalment {
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  penaltyAmount: number;
  paidDate?: string;
  status: LoanRepaymentStatus;
}

interface LoanStatementEmailProps {
  staffName: string;
  staffNo: string;
  organisationName: string;
  loan: {
    principalAmount: number;
    totalRepayable: number;
    interestRate: number;
    tenureMonths: number;
    disbursedDate: string;
    status: string;
    guarantorName: string;
  };
  kpis: {
    totalPaid: number;
    outstanding: number;
    penaltyPaid: number;
    completionRate: number;
  };
  instalments: LoanStatementEmailInstalment[];
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusColor(s: LoanRepaymentStatus): string {
  if (s === LoanRepaymentStatus.Paid) return '#16a34a';
  if (s === LoanRepaymentStatus.Partial) return '#d97706';
  if (s === LoanRepaymentStatus.Overdue) return '#dc2626';
  if (s === LoanRepaymentStatus.Waived) return '#6b7280';
  return '#374151';
}

export function renderLoanStatementEmail(props: LoanStatementEmailProps): string {
  const { staffName, staffNo, organisationName, loan, kpis, instalments } = props;

  const rowsHtml = instalments.map((r, i) => `
    <tr style="background-color:${i % 2 === 0 ? '#ffffff' : '#f9fafb'}">
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${r.instalmentNumber}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${new Date(r.dueDate).toLocaleDateString('en-GB')}</td>
      <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #e5e7eb">${fmt(r.dueAmount)}</td>
      <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #e5e7eb">${fmt(r.paidAmount)}</td>
      <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #e5e7eb">${r.penaltyAmount > 0 ? fmt(r.penaltyAmount) : '&mdash;'}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-GB') : '&mdash;'}</td>
      <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb;color:${statusColor(r.status)};font-weight:bold;font-size:11px">${r.status}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#111827;margin:0;padding:0;background-color:#f9fafb">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:24px 0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
          <tr>
            <td style="background-color:#1e40af;padding:24px 32px;color:#ffffff">
              <p style="margin:0;font-size:20px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:14px;opacity:0.85">Loan Statement</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f8fafc;border-bottom:1px solid #e5e7eb">
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
                <tr>
                  <td><strong>Name:</strong> ${staffName}</td>
                  <td align="right"><strong>Staff No:</strong> ${staffNo}</td>
                </tr>
                <tr>
                  <td style="padding-top:4px"><strong>Principal:</strong> GHS ${fmt(loan.principalAmount)}</td>
                  <td align="right" style="padding-top:4px"><strong>Total Repayable:</strong> GHS ${fmt(loan.totalRepayable)}</td>
                </tr>
                <tr>
                  <td style="padding-top:4px"><strong>Disbursed:</strong> ${new Date(loan.disbursedDate).toLocaleDateString('en-GB')}</td>
                  <td align="right" style="padding-top:4px"><strong>Tenure:</strong> ${loan.tenureMonths} months</td>
                </tr>
                <tr>
                  <td style="padding-top:4px"><strong>Guarantor:</strong> ${loan.guarantorName}</td>
                  <td align="right" style="padding-top:4px"><strong>Status:</strong> ${loan.status}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px">
              <table width="100%" cellpadding="8" cellspacing="0" style="background-color:#eff6ff;border-radius:6px;font-size:13px">
                <tr>
                  <td><strong>Paid:</strong> GHS ${fmt(kpis.totalPaid)}</td>
                  <td><strong>Outstanding:</strong> GHS ${fmt(kpis.outstanding)}</td>
                  <td><strong>Penalty:</strong> GHS ${fmt(kpis.penaltyPaid)}</td>
                  <td><strong>Completion:</strong> ${kpis.completionRate}%</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
                <thead>
                  <tr style="background-color:#1e40af;color:#ffffff">
                    <th style="padding:7px 8px;text-align:left;font-weight:normal">#</th>
                    <th style="padding:7px 8px;text-align:left;font-weight:normal">Due Date</th>
                    <th style="padding:7px 8px;text-align:right;font-weight:normal">Due (GHS)</th>
                    <th style="padding:7px 8px;text-align:right;font-weight:normal">Paid (GHS)</th>
                    <th style="padding:7px 8px;text-align:right;font-weight:normal">Penalty</th>
                    <th style="padding:7px 8px;text-align:left;font-weight:normal">Paid Date</th>
                    <th style="padding:7px 8px;text-align:center;font-weight:normal">Status</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background-color:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
              Generated: ${new Date().toLocaleDateString('en-GB')} | ${organisationName} &mdash; Welfare Department
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
