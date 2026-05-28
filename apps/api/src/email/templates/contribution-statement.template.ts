import { ContributionStatus } from '@welfare/shared';
import { getFontFaceCSS } from './fonts';

interface ContributionRow {
  month: number;
  expectedAmount: number;
  paidAmount: number;
  surplusCarriedForward: number;
  status: ContributionStatus;
}

interface OffsetRow {
  month: number;
  amount: number;
}

interface OffsetDetailRow {
  paidDate: string;
  borrowerName: string;
  loanRef: string;
  amount: number;
}

interface ContributionStatementProps {
  staffName: string;
  staffNo: string;
  year: number;
  organisationName: string;
  rows: ContributionRow[];
  totalExpected: number;
  totalPaid: number;
  totalMissed: number;
  netSurplus: number;
  offsetRows?: OffsetRow[];
  totalOffsets?: number;
  offsetDetail?: OffsetDetailRow[];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusColor(s: ContributionStatus): string {
  if (s === ContributionStatus.Paid) return '#16a34a';
  if (s === ContributionStatus.Partial) return '#d97706';
  return '#dc2626';
}

export function renderContributionStatement(props: ContributionStatementProps): string {
  const { staffName, staffNo, year, organisationName, rows, totalExpected, totalPaid, totalMissed, netSurplus } = props;
  const offsetRows = props.offsetRows ?? [];
  const totalOffsets = props.totalOffsets ?? 0;
  const offsetDetail = props.offsetDetail ?? [];
  const offsetByMonth = new Map(offsetRows.map(o => [o.month, o.amount]));

  const rowsHtml = rows.map((row, i) => {
    const offset = offsetByMonth.get(row.month);
    return `<tr style="background-color:${i % 2 === 0 ? '#ffffff' : '#f9fafb'}">
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${MONTH_NAMES[row.month - 1]}</td>
      <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #e5e7eb;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${fmt(row.expectedAmount)}</td>
      <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #e5e7eb;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${fmt(row.paidAmount)}</td>
      <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #e5e7eb;color:${offset ? '#dc2626' : '#9ca3af'};font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${offset ? `&minus;${fmt(offset)}` : '-'}</td>
      <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #e5e7eb;color:#16a34a;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${fmt(row.surplusCarriedForward)}</td>
      <td style="padding:7px 10px;text-align:center;border-bottom:1px solid #e5e7eb;color:${statusColor(row.status)};font-weight:bold;font-size:12px;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${row.status}</td>
    </tr>`;
  }).join('');

  const offsetDetailHtml =
    offsetDetail.length > 0
      ? `
    <tr>
      <td style="padding:0 32px 24px">
        <p style="font-size:12px;color:#6b7280;margin:0 0 8px">The following deductions were applied to your contributions to settle loans you guaranteed:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background-color:#fef2f2;color:#7f1d1d">
              <th style="padding:7px 10px;text-align:left;font-weight:normal">Date</th>
              <th style="padding:7px 10px;text-align:left;font-weight:normal">Borrower</th>
              <th style="padding:7px 10px;text-align:left;font-weight:normal">Loan Ref</th>
              <th style="padding:7px 10px;text-align:right;font-weight:normal">Amount (GHS)</th>
            </tr>
          </thead>
          <tbody>
            ${offsetDetail
              .map(
                (od, i) => `
            <tr style="background-color:${i % 2 === 0 ? '#ffffff' : '#fafafa'}">
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${od.paidDate}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${od.borrowerName}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${od.loanRef}</td>
              <td style="padding:6px 10px;text-align:right;border-bottom:1px solid #e5e7eb;color:#dc2626;font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">&minus;${fmt(od.amount)}</td>
            </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </td>
    </tr>`
      : '';

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
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
          <tr>
            <td style="background-color:#1e40af;padding:24px 32px;color:#ffffff">
              <p style="margin:0;font-size:20px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:14px;opacity:0.85">Welfare Contribution Statement - ${year}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f8fafc;border-bottom:1px solid #e5e7eb">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td><strong>Name:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${staffName}</span></td>
                  <td align="right"><strong>Staff No:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${staffNo}</span></td>
                </tr>
                <tr>
                  <td style="padding-top:4px"><strong>Year:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${year}</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px">
              <table width="100%" cellpadding="8" cellspacing="0" style="background-color:#eff6ff;border-radius:6px;font-size:13px">
                <tr>
                  <td><strong>Total Expected:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">GHS ${fmt(totalExpected)}</span></td>
                  <td><strong>Total Paid:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">GHS ${fmt(totalPaid)}</span></td>
                  <td><strong>Total Missed:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">GHS ${fmt(totalMissed)}</span></td>
                  <td><strong>Net Surplus:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">GHS ${fmt(netSurplus)}</span></td>
                  <td><strong>Loan Deductions:</strong> <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace;color:#dc2626">GHS ${fmt(totalOffsets)}</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="background-color:#1e40af;color:#ffffff">
                    <th style="padding:8px 10px;text-align:left;font-weight:normal">Month</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:normal">Expected (GHS)</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:normal">Paid (GHS)</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:normal">Offset (GHS)</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:normal">Surplus C/F</th>
                    <th style="padding:8px 10px;text-align:center;font-weight:normal">Status</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </td>
          </tr>
          ${offsetDetailHtml}
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
