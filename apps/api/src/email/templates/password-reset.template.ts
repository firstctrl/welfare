import { getFontFaceCSS } from './fonts';

interface PasswordResetProps {
  displayName: string;
  resetUrl: string;
  organisationName: string;
  expiresInHours: number;
  triggeredByAdmin: boolean;
}

export function renderPasswordResetTemplate(props: PasswordResetProps): string {
  const { displayName, resetUrl, organisationName, expiresInHours, triggeredByAdmin } = props;

  const intro = triggeredByAdmin
    ? 'An administrator initiated a password reset for your account.'
    : 'You requested a password reset for your account.';

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
            <td style="background-color:#2563eb;padding:20px 32px;color:#ffffff">
              <p style="margin:0;font-size:18px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Password Reset</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px">
              <p style="margin:0 0 16px">Hi ${displayName},</p>
              <p style="margin:0 0 16px">${intro} Click the button below to choose a new password. This link expires in ${expiresInHours} hour${expiresInHours === 1 ? '' : 's'}.</p>
              <p style="margin:0 0 24px">
                <a href="${resetUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600">Reset Password</a>
              </p>
              <p style="margin:0;font-size:12px;color:#6b7280">If you didn't expect this email, you can safely ignore it — your password won't change unless you click the link above and set a new one.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
