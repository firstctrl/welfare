import { getFontFaceCSS } from './fonts';

export const EMAIL_COLORS = {
  primary: '#bc4680',
  info: '#1671D9',
  warning: '#D69E2E',
  danger: '#CB1A14',
  success: '#0F973D',
  textPrimary: '#101928',
  textMuted: '#667085',
  border: '#E4E7EC',
  surface: '#F9FAFB',
} as const;

export type EmailAccent = 'primary' | 'info' | 'warning' | 'danger';

interface EmailShellProps {
  accent: EmailAccent;
  organisationName: string;
  eyebrow: string;
  bodyHtml: string;
  footerNote?: string;
}

const ACCENT_HEX: Record<EmailAccent, string> = {
  primary: EMAIL_COLORS.primary,
  info: EMAIL_COLORS.info,
  warning: EMAIL_COLORS.warning,
  danger: EMAIL_COLORS.danger,
};

export function renderEmailShell(props: EmailShellProps): string {
  const { accent, organisationName, eyebrow, bodyHtml, footerNote } = props;
  const headerColor = ACCENT_HEX[accent];

  return `<!DOCTYPE html>
<html>
<head>
  ${getFontFaceCSS()}
  <style>body,table,td,th,p,span,strong,a{font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif}</style>
</head>
<body style="font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;color:${EMAIL_COLORS.textPrimary};margin:0;padding:0;background-color:${EMAIL_COLORS.surface}">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid ${EMAIL_COLORS.border}">
          <tr>
            <td style="background-color:${headerColor};padding:20px 32px;color:#ffffff;border-radius:8px 8px 0 0">
              <p style="margin:0;font-size:18px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${eyebrow}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px;background-color:${EMAIL_COLORS.surface};border-top:1px solid ${EMAIL_COLORS.border};font-size:12px;color:${EMAIL_COLORS.textMuted}">
              Generated: ${new Date().toLocaleDateString('en-GB')} | ${organisationName}${footerNote ? ` | ${footerNote}` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function fmtGHS(n: number): string {
  return `GHS ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function mono(s: string | number): string {
  return `<span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${s}</span>`;
}
