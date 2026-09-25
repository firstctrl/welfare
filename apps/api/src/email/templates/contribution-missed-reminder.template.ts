import { renderEmailShell, mono } from './theme';

interface MissedContributionReminderProps {
  staffName: string;
  month: number;
  year: number;
  organisationName: string;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function renderMissedContributionReminder(props: MissedContributionReminderProps): string {
  const { staffName, month, year, organisationName } = props;
  const period = `${MONTH_NAMES[month - 1]} ${year}`;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(staffName)},</p>
    <p style="margin:0 0 16px">Our records show no welfare contribution has been recorded for you for <strong>${period}</strong>.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FEF6E7;border-radius:6px;font-size:13px">Please arrange payment as soon as possible to keep your contribution record up to date.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">If you have already made this payment, please disregard this notice.</p>
  `;

  return renderEmailShell({
    accent: 'warning',
    organisationName,
    eyebrow: 'Missed Contribution Reminder',
    bodyHtml,
  });
}
