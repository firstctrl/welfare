import { renderEmailShell, fmtGHS, mono } from './theme';

interface GracePeriodWarningProps {
  recipientName: string;
  role: 'Borrower' | 'Guarantor';
  loanRef: string;
  principalAmount: number;
  graceExpiryDate: string;
  organisationName: string;
}

export function renderGracePeriodWarning(props: GracePeriodWarningProps): string {
  const { recipientName, role, loanRef, principalAmount, graceExpiryDate, organisationName } = props;

  const bodyHtml = role === 'Borrower'
    ? `
    <p style="margin:0 0 16px">Dear ${mono(recipientName)},</p>
    <p style="margin:0 0 16px">Your loan (Ref: ${mono(loanRef)}, principal ${fmtGHS(principalAmount)}) has reached the end of its tenure and is still outstanding. Your grace period ends on <strong>${new Date(graceExpiryDate).toLocaleDateString('en-GB')}</strong>.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FBEAE9;border-radius:6px;font-size:13px">If the loan is not settled before then, your guarantor's contribution balance — and if needed, your own — will be used to cover the outstanding amount.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">Please contact the welfare office to settle this loan before the grace period ends.</p>
  `
    : `
    <p style="margin:0 0 16px">Dear ${mono(recipientName)},</p>
    <p style="margin:0 0 16px">A loan you guaranteed (Ref: ${mono(loanRef)}, principal ${fmtGHS(principalAmount)}) is past its tenure and still outstanding. The borrower's grace period ends on <strong>${new Date(graceExpiryDate).toLocaleDateString('en-GB')}</strong>.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FBEAE9;border-radius:6px;font-size:13px">If it remains unpaid after that date, your contribution balance may be used to cover the shortfall, in line with the guarantee you provided.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">This is an early notice so you can follow up with the borrower before that happens.</p>
  `;

  return renderEmailShell({
    accent: 'danger',
    organisationName,
    eyebrow: 'Grace Period Ending Soon',
    bodyHtml,
  });
}
