import { renderEmailShell, fmtGHS, mono } from './theme';

interface GuarantorRestitutionReminderProps {
  guarantorName: string;
  borrowerName: string;
  loanRef: string;
  amountOwed: number;
  organisationName: string;
}

export function renderGuarantorRestitutionReminder(props: GuarantorRestitutionReminderProps): string {
  const { guarantorName, borrowerName, loanRef, amountOwed, organisationName } = props;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(guarantorName)},</p>
    <p style="margin:0 0 16px">You are still owed <strong>${fmtGHS(amountOwed)}</strong> in restitution for contributions previously used to cover a default on a loan you guaranteed for <strong>${borrowerName}</strong> (Ref: ${mono(loanRef)}).</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#E3EFFC;border-radius:6px;font-size:13px">This amount will continue to be restored to your contribution balance as the borrower repays, and any remainder will be settled in full once the loan is fully paid off.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">This is a routine status update — no action is required on your part.</p>
  `;

  return renderEmailShell({
    accent: 'info',
    organisationName,
    eyebrow: 'Restitution Still Outstanding',
    bodyHtml,
  });
}
