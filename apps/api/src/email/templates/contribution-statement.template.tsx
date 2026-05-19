import * as React from 'react';
import { render } from '@react-email/render';
import { ContributionStatus } from '@welfare/shared';

interface ContributionRow {
  month: number;
  expectedAmount: number;
  paidAmount: number;
  surplusCarriedForward: number;
  status: ContributionStatus;
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
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(n: number) {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusColor(s: ContributionStatus): string {
  if (s === ContributionStatus.Paid) return '#16a34a';
  if (s === ContributionStatus.Partial) return '#d97706';
  return '#dc2626';
}

export function ContributionStatementEmail(props: ContributionStatementProps) {
  const { staffName, staffNo, year, organisationName, rows, totalExpected, totalPaid, totalMissed, netSurplus } = props;

  return (
    <html>
      <body style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#111827', margin: 0, padding: 0, backgroundColor: '#f9fafb' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#f9fafb', padding: '24px 0' }}>
          <tr>
            <td align="center">
              <table width="600" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                <tr>
                  <td style={{ backgroundColor: '#1e40af', padding: '24px 32px', color: '#ffffff' }}>
                    <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>{organisationName}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.85 }}>Welfare Contribution Statement — {year}</p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '20px 32px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0}>
                      <tr>
                        <td><strong>Name:</strong> {staffName}</td>
                        <td align="right"><strong>Staff No:</strong> {staffNo}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '4px' }}><strong>Year:</strong> {year}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '20px 32px' }}>
                    <table width="100%" cellPadding={8} cellSpacing={0} style={{ backgroundColor: '#eff6ff', borderRadius: '6px', fontSize: '13px' }}>
                      <tr>
                        <td><strong>Total Expected:</strong> GHS {fmt(totalExpected)}</td>
                        <td><strong>Total Paid:</strong> GHS {fmt(totalPaid)}</td>
                        <td><strong>Total Missed:</strong> GHS {fmt(totalMissed)}</td>
                        <td><strong>Net Surplus:</strong> GHS {fmt(netSurplus)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '0 32px 24px' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#1e40af', color: '#ffffff' }}>
                          <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 'normal' }}>Month</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'normal' }}>Expected (GHS)</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'normal' }}>Paid (GHS)</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'normal' }}>Surplus C/F</th>
                          <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 'normal' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                            <td style={{ padding: '7px 10px', borderBottom: '1px solid #e5e7eb' }}>{MONTH_NAMES[row.month - 1]}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(row.expectedAmount)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(row.paidAmount)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb', color: '#16a34a' }}>{fmt(row.surplusCarriedForward)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: statusColor(row.status), fontWeight: 'bold', fontSize: '12px' }}>{row.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '16px 32px', backgroundColor: '#f8fafc', borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#6b7280' }}>
                    Generated: {new Date().toLocaleDateString('en-GB')} | {organisationName} — Welfare Department
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  );
}

export async function renderContributionStatement(props: ContributionStatementProps): Promise<string> {
  return render(<ContributionStatementEmail {...props} />);
}
