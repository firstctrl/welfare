import { renderEmailShell, mono } from './theme';

interface GuarantorCapNoticeProps {
  guarantorName: string;
  activeCount: number;
  maxPerGuarantor: number;
  loanRef: string;
  organisationName: string;
}

export function renderGuarantorCapNotice(props: GuarantorCapNoticeProps): string {
  const { guarantorName, activeCount, maxPerGuarantor, loanRef, organisationName } = props;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(guarantorName)},</p>
    <p style="margin:0 0 16px">You have just co-signed loan ${mono(loanRef)}, bringing your active guarantees to <strong>${activeCount} of ${maxPerGuarantor}</strong> — the maximum allowed at one time.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#fbf4f8;border-radius:6px;font-size:13px">You will not be able to guarantee another loan until one of your current guarantees is fully repaid.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">This is an informational notice — no action is required.</p>
  `;

  return renderEmailShell({
    accent: 'primary',
    organisationName,
    eyebrow: 'Guarantor Limit Reached',
    bodyHtml,
  });
}
