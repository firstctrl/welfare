interface ForfeitureNoticeProps {
  staffName: string;
  loanRef: string;
  originalTotal: number;
  revisedTotal: number;
  clawbackAmount: number;
  newOutstanding: number;
  organisationName: string;
}

function fmt(n: number): string {
  return `GHS ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function renderLoanForfeitureNotice(props: ForfeitureNoticeProps): string {
  const { staffName, loanRef, originalTotal, revisedTotal, clawbackAmount, newOutstanding, organisationName } = props;

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#111827;margin:0;padding:0;background-color:#f9fafb">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #e5e7eb">
          <tr>
            <td style="background-color:#b91c1c;padding:20px 32px;color:#ffffff">
              <p style="margin:0;font-size:18px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Interest Rate Adjustment Notice</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px">
              <p style="margin:0 0 16px">Dear ${staffName},</p>
              <p style="margin:0 0 16px">Your loan (Ref: <strong>${loanRef}</strong>) was approved under a short-tenure (&le; 6 months) arrangement at a discounted rate of <strong>10%</strong>. This discount is conditional on full settlement within the agreed tenure.</p>
              <p style="margin:0 0 16px">As your loan has exceeded the 6-month period with an outstanding balance, the preferential rate has been withdrawn and your loan has been adjusted to the standard rate of <strong>15%</strong>.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px">
                <tr style="background-color:#f9fafb">
                  <td style="padding:8px 12px;font-weight:bold;color:#374151">Original Total Repayable (10%)</td>
                  <td style="padding:8px 12px;text-align:right">${fmt(originalTotal)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 12px;font-weight:bold;color:#374151">Revised Total Repayable (15%)</td>
                  <td style="padding:8px 12px;text-align:right">${fmt(revisedTotal)}</td>
                </tr>
                <tr style="background-color:#fef2f2">
                  <td style="padding:8px 12px;font-weight:bold;color:#b91c1c">Additional Amount Reinstated</td>
                  <td style="padding:8px 12px;text-align:right;color:#b91c1c">${fmt(clawbackAmount)}</td>
                </tr>
                <tr style="border-top:2px solid #e5e7eb">
                  <td style="padding:8px 12px;font-weight:bold">New Outstanding Balance</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:bold">${fmt(newOutstanding)}</td>
                </tr>
              </table>
              <p style="margin:0 0 16px;font-size:13px;color:#6b7280">Please contact us on <strong>0244779991 / 0242906159</strong> if you have any questions.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px;background-color:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
              ${organisationName} &mdash; Welfare Department | Generated: ${new Date().toLocaleDateString('en-GB')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
