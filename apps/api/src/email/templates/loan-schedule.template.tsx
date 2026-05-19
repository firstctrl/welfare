import * as React from 'react';
import { render } from '@react-email/render';
import { LoanRepaymentStatus } from '@welfare/shared';

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

function fmt(n: number) {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusColor(s: LoanRepaymentStatus): string {
  if (s === LoanRepaymentStatus.Paid) return '#16a34a';
  if (s === LoanRepaymentStatus.Overdue) return '#dc2626';
  if (s === LoanRepaymentStatus.Partial) return '#d97706';
  return '#6b7280';
}

export function LoanScheduleEmail(props: LoanScheduleProps) {
  const { staffName, staffNo, loanId, disbursedDate, principalAmount, interestRate, totalRepayable, organisationName, schedule, totalPaid, totalOutstanding, loanStatus } = props;

  return (
    <html>
      <body style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#111827', margin: 0, padding: 0, backgroundColor: '#f9fafb' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#f9fafb', padding: '24px 0' }}>
          <tr>
            <td align="center">
              <table width="620" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                <tr>
                  <td style={{ backgroundColor: '#1e40af', padding: '24px 32px', color: '#ffffff' }}>
                    <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>{organisationName}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.85 }}>Loan Repayment Schedule</p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '20px 32px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <table width="100%" cellPadding={4} cellSpacing={0} style={{ fontSize: '13px' }}>
                      <tr>
                        <td><strong>Name:</strong> {staffName}</td>
                        <td align="right"><strong>Staff No:</strong> {staffNo}</td>
                      </tr>
                      <tr>
                        <td><strong>Loan ID:</strong> <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{loanId}</span></td>
                        <td align="right"><strong>Disbursed:</strong> {new Date(disbursedDate).toLocaleDateString('en-GB')}</td>
                      </tr>
                      <tr>
                        <td><strong>Principal:</strong> GHS {fmt(principalAmount)}</td>
                        <td align="right"><strong>Interest Rate:</strong> {interestRate}%</td>
                      </tr>
                      <tr>
                        <td><strong>Total Repayable:</strong> GHS {fmt(totalRepayable)}</td>
                        <td align="right"><strong>Status:</strong> {loanStatus}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '20px 32px 24px' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#1e40af', color: '#ffffff' }}>
                          {['#', 'Due Date', 'Amount Due (GHS)', 'Paid (GHS)', 'Outstanding', 'Status'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: h === '#' ? 'center' : 'left', fontWeight: 'normal' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.map((row, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                            <td style={{ padding: '7px 10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>{row.instalmentNumber}</td>
                            <td style={{ padding: '7px 10px', borderBottom: '1px solid #e5e7eb' }}>{new Date(row.dueDate).toLocaleDateString('en-GB')}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(row.dueAmount)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb', color: '#16a34a' }}>{fmt(row.paidAmount)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(row.outstanding)}</td>
                            <td style={{ padding: '7px 10px', borderBottom: '1px solid #e5e7eb', color: statusColor(row.status), fontWeight: 'bold', fontSize: '12px' }}>{row.status}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ backgroundColor: '#f1f5f9', fontWeight: 'bold' }}>
                          <td colSpan={3} style={{ padding: '8px 10px' }}>Total</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: '#16a34a' }}>{fmt(totalPaid)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmt(totalOutstanding)}</td>
                          <td />
                        </tr>
                      </tfoot>
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

export async function renderLoanSchedule(props: LoanScheduleProps): Promise<string> {
  return render(<LoanScheduleEmail {...props} />);
}
