import * as React from 'react';
import { render } from '@react-email/render';

interface LoanPaymentReminderProps {
  staffName: string;
  loanRef: string;
  amountDue: number;
  dueDate: string;
  organisationName: string;
}

function fmt(n: number) {
  return `GHS ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function LoanPaymentReminderEmail(props: LoanPaymentReminderProps) {
  const { staffName, loanRef, amountDue, dueDate, organisationName } = props;
  return (
    <html>
      <body style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#111827', margin: 0, padding: 0, backgroundColor: '#f9fafb' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ padding: '24px 0' }}>
          <tr>
            <td align="center">
              <table width="520" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <tr>
                  <td style={{ backgroundColor: '#d97706', padding: '20px 32px', color: '#ffffff' }}>
                    <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>{organisationName}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.9 }}>Loan Payment Reminder</p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '28px 32px' }}>
                    <p style={{ margin: '0 0 16px' }}>Dear {staffName},</p>
                    <p style={{ margin: '0 0 16px' }}>
                      This is a reminder that your loan instalment of <strong>{fmt(amountDue)}</strong> (Ref: <strong>{loanRef}</strong>) is due in <strong>7 days</strong> on <strong>{new Date(dueDate).toLocaleDateString('en-GB')}</strong>.
                    </p>
                    <p style={{ margin: '0 0 16px', padding: '12px 16px', backgroundColor: '#fef3c7', borderRadius: '6px', fontSize: '13px' }}>
                      Please ensure payment is made before the due date to avoid any penalties.
                    </p>
                    <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                      For enquiries, contact us on: <strong>0244779991 / 0242906159</strong>
                    </p>
                    <p style={{ margin: '0', color: '#6b7280', fontSize: '13px' }}>
                      If you have already made this payment, please disregard this notice.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '12px 32px', backgroundColor: '#f8fafc', borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#6b7280' }}>
                    {organisationName} — Welfare Department | Generated: {new Date().toLocaleDateString('en-GB')}
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

export async function renderLoanPaymentReminder(props: LoanPaymentReminderProps): Promise<string> {
  return render(<LoanPaymentReminderEmail {...props} />);
}
