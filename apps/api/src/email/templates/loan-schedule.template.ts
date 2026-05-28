import { LoanRepaymentStatus } from '@welfare/shared';
import { getFontFaceCSS } from './fonts';

interface ScheduleRow {
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  outstanding: number;
  status: LoanRepaymentStatus;
}

interface LoanScheduleProps {
  staffName: string;
  staffNo: string;
  loanId: string;
  disbursedDate: string;
  principalAmount: number;
  interestRate: number;
  totalRepayable: number;
  organisationName: string;
  schedule: ScheduleRow[];
  totalPaid: number;
  totalOutstanding: number;
  loanStatus: string;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusColor(s: LoanRepaymentStatus): string {
  if (s === LoanRepaymentStatus.Paid) return '#16a34a';
  if (s === LoanRepaymentStatus.Overdue) return '#dc2626';
  if (s === LoanRepaymentStatus.Partial) return '#d97706';
  return '#6b7280';
}

export function renderLoanSchedule(props: LoanScheduleProps): string {
  const { staffName, staffNo, loanId, disbursedDate, principalAmount, interestRate, totalRepayable, organisationName, schedule, totalPaid, totalOutstanding, loanStatus } = props;
  const JBM = "font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace";

  const rowsHtml = schedule
    .map(
      (row, i) => `
    <tr style="background-color:${i % 2 === 0 ? '#ffffff' : '#f9fafb'}">
      <td style="padding:7px 10px;text-align:center;border-bottom:1px solid #e5e7eb;${JBM}">${row.instalmentNumber}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;${JBM}">${new Date(row.dueDate).toLocaleDateString('en-GB')}</td>
      <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #e5e7eb;${JBM}">${fmt(row.dueAmount)}</td>
      <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #e5e7eb;color:#16a34a;${JBM}">${fmt(row.paidAmount)}</td>
      <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #e5e7eb;${JBM}">${fmt(row.outstanding)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:${statusColor(row.status)};font-weight:bold;font-size:12px;${JBM}">${row.status}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  ${getFontFaceCSS()}
  <style>body,table,td,th,p,span,strong,a{font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif}</style>
</head>
<body style="font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;color:#111827;margin:0;padding:0;background-color:#f9fafb">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:24px 0">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
          <tr>
            <td style="background-color:#1e40af;padding:24px 32px;color:#ffffff">
              <p style="margin:0;font-size:20px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:14px;opacity:0.85">Loan Repayment Schedule</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f8fafc;border-bottom:1px solid #e5e7eb">
              <table width="100%" cellpadding="4" cellspacing="0" style="font-size:13px">
                <tr>
                  <td><strong>Name:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${staffName}</span></td>
                  <td align="right"><strong>Staff No:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${staffNo}</span></td>
                </tr>
                <tr>
                  <td><strong>Loan ID:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace;font-size:12px">${loanId}</span></td>
                  <td align="right"><strong>Disbursed:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${new Date(disbursedDate).toLocaleDateString('en-GB')}</span></td>
                </tr>
                <tr>
                  <td><strong>Principal:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">GHS ${fmt(principalAmount)}</span></td>
                  <td align="right"><strong>Interest Rate:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${interestRate}%</span></td>
                </tr>
                <tr>
                  <td><strong>Total Repayable:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">GHS ${fmt(totalRepayable)}</span></td>
                  <td align="right"><strong>Status:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${loanStatus}</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="background-color:#1e40af;color:#ffffff">
                    <th style="padding:8px 10px;text-align:center;font-weight:normal">#</th>
                    <th style="padding:8px 10px;text-align:left;font-weight:normal">Due Date</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:normal">Amount Due (GHS)</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:normal">Paid (GHS)</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:normal">Outstanding</th>
                    <th style="padding:8px 10px;text-align:left;font-weight:normal">Status</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                  <tr style="background-color:#f1f5f9;font-weight:bold">
                    <td colspan="3" style="padding:8px 10px">Total</td>
                    <td style="padding:8px 10px;text-align:right;color:#16a34a;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${fmt(totalPaid)}</td>
                    <td style="padding:8px 10px;text-align:right;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${fmt(totalOutstanding)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background-color:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
              Generated: <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${new Date().toLocaleDateString('en-GB')}</span> | ${organisationName}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
