import * as React from 'react';
import { render } from '@react-email/render';
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

function fmt(n: number) {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusColor(s: LoanRepaymentStatus): string {
  if (s === LoanRepaymentStatus.Paid) return '#16a34a';
  if (s === LoanRepaymentStatus.Partial) return '#d97706';
  if (s === LoanRepaymentStatus.Overdue) return '#dc2626';
  if (s === LoanRepaymentStatus.Waived) return '#6b7280';
  return '#374151';
}

export function LoanStatementEmail(props: LoanStatementEmailProps) {
  const { staffName, staffNo, organisationName, loan, kpis, instalments } = props;

  return (
    <html>
      <body style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#111827', margin: 0, padding: 0, backgroundColor: '#f9fafb' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#f9fafb', padding: '24px 0' }}>
          <tr>
            <td align="center">
              <table width="600" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                {/* Header */}
                <tr>
                  <td style={{ backgroundColor: '#1e40af', padding: '24px 32px', color: '#ffffff' }}>
                    <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>{organisationName}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.85 }}>Loan Statement</p>
                  </td>
                </tr>
                {/* Staff + loan info */}
                <tr>
                  <td style={{ padding: '20px 32px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ fontSize: '13px' }}>
                      <tr>
                        <td><strong>Name:</strong> {staffName}</td>
                        <td align="right"><strong>Staff No:</strong> {staffNo}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '4px' }}><strong>Principal:</strong> GHS {fmt(loan.principalAmount)}</td>
                        <td align="right" style={{ paddingTop: '4px' }}><strong>Total Repayable:</strong> GHS {fmt(loan.totalRepayable)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '4px' }}><strong>Disbursed:</strong> {new Date(loan.disbursedDate).toLocaleDateString('en-GB')}</td>
                        <td align="right" style={{ paddingTop: '4px' }}><strong>Tenure:</strong> {loan.tenureMonths} months</td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '4px' }}><strong>Guarantor:</strong> {loan.guarantorName}</td>
                        <td align="right" style={{ paddingTop: '4px' }}><strong>Status:</strong> {loan.status}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                {/* KPI box */}
                <tr>
                  <td style={{ padding: '20px 32px' }}>
                    <table width="100%" cellPadding={8} cellSpacing={0} style={{ backgroundColor: '#eff6ff', borderRadius: '6px', fontSize: '13px' }}>
                      <tr>
                        <td><strong>Paid:</strong> GHS {fmt(kpis.totalPaid)}</td>
                        <td><strong>Outstanding:</strong> GHS {fmt(kpis.outstanding)}</td>
                        <td><strong>Penalty:</strong> GHS {fmt(kpis.penaltyPaid)}</td>
                        <td><strong>Completion:</strong> {kpis.completionRate}%</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                {/* Instalment table */}
                <tr>
                  <td style={{ padding: '0 32px 24px' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#1e40af', color: '#ffffff' }}>
                          <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 'normal' }}>#</th>
                          <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 'normal' }}>Due Date</th>
                          <th style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 'normal' }}>Due (GHS)</th>
                          <th style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 'normal' }}>Paid (GHS)</th>
                          <th style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 'normal' }}>Penalty</th>
                          <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 'normal' }}>Paid Date</th>
                          <th style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 'normal' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {instalments.map((r, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>{r.instalmentNumber}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>{new Date(r.dueDate).toLocaleDateString('en-GB')}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(r.dueAmount)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(r.paidAmount)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{r.penaltyAmount > 0 ? fmt(r.penaltyAmount) : '—'}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>{r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-GB') : '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: statusColor(r.status), fontWeight: 'bold', fontSize: '11px' }}>{r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
                {/* Footer */}
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

export async function renderLoanStatementEmail(props: LoanStatementEmailProps): Promise<string> {
  return render(<LoanStatementEmail {...props} />);
}
