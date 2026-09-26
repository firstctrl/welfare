export enum RepaymentSource {
  DirectPayment = 'DirectPayment',
  Import = 'Import',
  GuarantorOffset = 'GuarantorOffset',
  DefaulterDeduction = 'DefaulterDeduction',
  ExitDeduction = 'ExitDeduction',
  PayOff = 'PayOff',
}

export const REPAYMENT_SOURCE_LABELS: Record<RepaymentSource, string> = {
  [RepaymentSource.DirectPayment]: 'Direct Payment',
  [RepaymentSource.Import]: 'Import',
  [RepaymentSource.GuarantorOffset]: 'Guarantor Offset',
  [RepaymentSource.DefaulterDeduction]: 'Defaulter Deduction',
  [RepaymentSource.ExitDeduction]: 'Exit Deduction',
  [RepaymentSource.PayOff]: 'Pay Off',
};

export function repaymentSourceLabel(source?: string | null): string {
  if (!source) return '—';
  return REPAYMENT_SOURCE_LABELS[source as RepaymentSource] ?? source;
}

