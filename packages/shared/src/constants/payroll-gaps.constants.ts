export interface IPayrollGapPeriod {
  year: number;
  month: number;
}

// Months with no contribution deduction due to payroll system maintenance —
// not missed payments, just a blank period. Add future gaps here.
export const PAYROLL_GAP_PERIODS: IPayrollGapPeriod[] = [
  { year: 2015, month: 6 },
  { year: 2015, month: 7 },
];

export const PAYROLL_GAP_NOTICE =
  'No contribution was deducted for Jun 2015 and Jul 2015 due to payroll system migration by CAG during that period. These months are intentionally blank, not missed payments.';

/**
 * True when a staff member's contribution history spans a known payroll gap
 * (has records both before and after it), meaning the blank months in their
 * ledger are explained by the gap rather than being genuinely missed.
 */
export function hasPayrollGapDuringHistory(
  contributionDates: Array<{ month: number; year: number }>,
): boolean {
  if (contributionDates.length === 0 || PAYROLL_GAP_PERIODS.length === 0) return false;
  const key = (d: { year: number; month: number }) => d.year * 12 + d.month;
  const gapKeys = PAYROLL_GAP_PERIODS.map(key);
  const gapStart = Math.min(...gapKeys);
  const gapEnd = Math.max(...gapKeys);
  const hasBefore = contributionDates.some((d) => key(d) < gapStart);
  const hasAfter = contributionDates.some((d) => key(d) > gapEnd);
  return hasBefore && hasAfter;
}
