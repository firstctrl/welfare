import { renderEmailShell, fmtGHS, mono } from './theme';

interface LoanOverdueReminderProps {
  staffName: string;
  loanRef: string;
  outstandingAmount: number;
  organisationName: string;
}

export function renderLoanOverdueReminder(props: LoanOverdueReminderProps): string {
  const { staffName, loanRef, outstandingAmount, organisationName } = props;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(staffName)},</p>
    <p style="margin:0 0 16px">Your loan instalment of <strong>${fmtGHS(outstandingAmount)}</strong> (Ref: ${mono(loanRef)}) is now <strong>overdue</strong>.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FEF6E7;border-radius:6px;font-size:13px">Please make payment promptly. If this remains unpaid beyond the grace period, your guarantor's and/or your own contribution balance may be used to cover the shortfall.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">If you have already made this payment, please disregard this notice.</p>
  `;

  return renderEmailShell({
    accent: 'warning',
    organisationName,
    eyebrow: 'Loan Instalment Overdue',
    bodyHtml,
  });
}
