import { getFontFaceCSS } from './fonts';

interface LoanPaymentReminderProps {
  staffName: string;
  loanRef: string;
  amountDue: number;
  dueDate: string;
  organisationName: string;
}

function fmt(n: number): string {
  return `GHS ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function renderLoanPaymentReminder(props: LoanPaymentReminderProps): string {
  const { staffName, loanRef, amountDue, dueDate, organisationName } = props;

  return `<!DOCTYPE html>
<html>
<head>
  ${getFontFaceCSS()}
  <style>body,table,td,th,p,span,strong,a{font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif}</style>
</head>
<body style="font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;color:#111827;margin:0;padding:0;background-color:#f9fafb">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #e5e7eb">
          <tr>
            <td style="background-color:#d97706;padding:20px 32px;color:#ffffff">
              <p style="margin:0;font-size:18px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Loan Payment Reminder</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px">
              <p style="margin:0 0 16px">Dear <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${staffName}</span>,</p>
              <p style="margin:0 0 16px">This is a reminder that your loan instalment of <strong style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${fmt(amountDue)}</strong> (Ref: <span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace;font-weight:bold">${loanRef}</span>) is due in <strong>7 days</strong> on <strong style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${new Date(dueDate).toLocaleDateString('en-GB')}</strong>.</p>
              <p style="margin:0 0 16px;padding:12px 16px;background-color:#fef3c7;border-radius:6px;font-size:13px">Please ensure payment is made before the due date to avoid any penalties.</p>
              <p style="margin:0 0 8px;font-size:13px">For enquiries, contact us on: <strong>0244779991 / 0242906159</strong></p>
              <p style="margin:0;color:#6b7280;font-size:13px">If you have already made this payment, please disregard this notice.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px;background-color:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
              Generated: ${new Date().toLocaleDateString('en-GB')} | ${organisationName} 
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
